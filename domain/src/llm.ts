import {
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionMessage,
} from "openai/resources/index";
import { ChatMessage, type LlmUsage, type MessageMeta } from "./type";
import type { LlmProvider } from "./config";
import OpenAI from "openai";
import { anthropicCall } from "./providers/anthropic";

type LlmResult = ChatCompletionMessage & { usage?: LlmUsage; _meta?: MessageMeta };

/** 重试默认值（AR-1）：3 次、初始 1s 指数退避 + 抖动；provider.retry 可覆盖。 */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * 错误可重试判定（AR-1）：429 / 5xx / 网络连接类 / 空响应 可重试；
 * 4xx 参数与鉴权类、abort 不可重试。
 */
export function isRetryableError(err: unknown): boolean {
    const name = (err as { name?: unknown })?.name;
    if (name === "AbortError" || name === "APIUserAbortError") return false;
    const status = (err as { status?: unknown })?.status;
    if (typeof status === "number") return status === 429 || status >= 500;
    // 无 HTTP status：网络连接类（openai APIConnectionError / fetch failed 等）
    if (name === "APIConnectionError") return true;
    const msg = String((err as Error)?.message ?? err);
    return /fetch failed|network|connection error|econn|etimedout|socket|terminated|llm returned no content/i.test(
        msg
    );
}

/** 尊重服务端 Retry-After 头（秒或 HTTP 日期；日期解析失败忽略）。 */
export function retryAfterDelayMs(err: unknown): number | undefined {
    const headers = (err as { headers?: unknown })?.headers;
    if (!headers || typeof headers !== "object") return undefined;
    const raw = (headers as Record<string, unknown>)["retry-after"];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw * 1000;
    if (typeof raw === "string") {
        const sec = Number(raw);
        if (Number.isFinite(sec)) return sec * 1000;
        const date = Date.parse(raw);
        if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
    }
    return undefined;
}

/** abort 可中断的 sleep：等待期间 abort 立即抛出（重试等待不拖住 stop）。 */
async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
        await new Promise((r) => setTimeout(r, ms));
        return;
    }
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * 重试执行器（AR-1，纯 seam 便于直测）：fn 失败按指数退避重试（默认 3 次 + 25% 抖动），
 * 服务端 Retry-After 优先；4xx/abort 不重试；abort 可中断等待。
 * callLLM 用它包裹 streamCall/nonStreamCall；onRetry 供调用方发可见性事件。
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: {
        maxRetries: number;
        baseDelayMs: number;
        signal?: AbortSignal;
        onRetry?: (info: { attempt: number; maxRetries: number; delayMs: number; error: string }) => void;
    }
): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (err) {
            // abort：直接向上（agentLoop 按 signal.aborted 走 STOPPED 语义）
            if (opts.signal?.aborted) throw err;
            if (attempt >= opts.maxRetries || !isRetryableError(err)) throw err;
            // Retry-After 优先（服务端明确指示），否则指数退避 + 25% 抖动
            const retryAfter = retryAfterDelayMs(err);
            const backoff = opts.baseDelayMs * 2 ** attempt * (1 + Math.random() * 0.25);
            const delayMs = Math.round(Math.max(retryAfter ?? 0, backoff));
            opts.onRetry?.({
                attempt: attempt + 1,
                maxRetries: opts.maxRetries,
                delayMs,
                error: err instanceof Error ? err.message : String(err),
            });
            await abortableSleep(delayMs, opts.signal);
        }
    }
}

/**
 * 上下文超限类错误判定（AR-9）：provider 对超长 prompt 的拒绝文案各家不一，
 * 按主流措辞做宽匹配（不误伤 4xx 鉴权类——那些 message 不含这些词）。
 */
export function isContextOverflowError(err: unknown): boolean {
    const msg = String((err as Error)?.message ?? err);
    return /context length|prompt is too long|maximum context|context_window|too many tokens|request too large|reduce the length/i.test(
        msg
    );
}

/** 剥离 assistant message 上的非标准 _meta sidecar，避免发给 provider（部分 provider 会 400）。SPEC-017 C-002 */
function stripMeta(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((m) => {
        const rec = m as unknown as Record<string, unknown>;
        if (!("_meta" in rec)) return m;
        const { _meta, ...rest } = rec;
        void _meta;
        return rest as unknown as ChatMessage;
    });
}

/**
 * 调用 LLM。按传入 provider 的 streaming 决定流式 / 非流式（provider 粒度开关）。
 * 流式：消费 chunk 累积成完整 message（content 拼接 + tool_calls 按 index 拼装），onDelta 发增量；
 *       onThinkingDelta 发 reasoning_content 增量（部分思考型模型支持）；
 *       abort 时返回已累积的截断 message（仅 content）不抛。
 * 非流式：整段返回 choices[0].message。
 * usage：捕获响应 token 用量（非流式 resp.usage；流式 stream_options.include_usage 末片）附在返回 message 上。
 * llm 由调用方（AnyAgent 从 config.yaml 解析）传入，必填。
 * 重试（AR-1）：429/5xx/网络/空响应按指数退避自动重试（默认 3 次，provider.retry 可配），
 *   服务端 Retry-After 优先；每次重试经 onRetry 通知调用方（core.ts 发 Warning 可见）；
 *   abort 随时中断（含等待期）。
 */
export async function callLLM(
    messages: ChatMessage[],
    params?: Partial<ChatCompletionCreateParamsNonStreaming>,
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
    llm?: LlmProvider,
    onThinkingDelta?: (delta: string) => void,
    onToolArgProgress?: (info: { name?: string; bytes: number }) => void,
    onRetry?: (info: { attempt: number; maxRetries: number; delayMs: number; error: string }) => void
): Promise<LlmResult> {
    if (!llm) {
        throw new Error("callLLM 需要 provider 配置（由 AnyAgent 从 config.yaml 解析传入）");
    }
    const provider = llm;
    const client = new OpenAI({
        apiKey: provider.apiKey,
        baseURL: provider.baseURL,
    });
    // 剥离 _meta sidecar：发给 provider 的 messages 不得含非标准字段（SPEC-017 C-002）
    // tools 完全由调用方经 params 决定（agentLoop 传全量 schema；起名/测试等辅助调用传 undefined）。
    const payload: ChatCompletionCreateParamsNonStreaming = {
        model: provider.defaultModel,
        messages: stripMeta(messages),
        ...params,
    };
    // max_tokens：用 resolved maxOutputTokens（探测/表/用户取 min）。undefined 不传（provider 默认）。
    // SPEC-023 B-004。放 ...params 后以覆盖调用方默认，但保留显式 params 覆盖能力。
    if (typeof provider.maxOutputTokens === "number") {
        payload.max_tokens = provider.maxOutputTokens;
    }
    const maxRetries = provider.retry?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const baseDelayMs = provider.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    // signal 透传：stop() abort 时流式生成抛 AbortError（withRetry 内兜底）/ 非流式 fetch 取消。
    // AR-15：按 provider.protocol 分派协议适配器（anthropic 适配器内部自带流式/非流式与归一化）。
    if (provider.protocol === "anthropic") {
        // AnthropicResult 与 LlmResult 结构兼容（role/content/tool_calls/usage/_meta）
        return withRetry(
            () =>
                anthropicCall(messages, params as never, signal, provider, {
                    onDelta,
                    onThinkingDelta,
                    onToolArgProgress,
                }) as Promise<LlmResult>,
            { maxRetries, baseDelayMs, signal, onRetry }
        );
    }
    return withRetry(
        () =>
            provider.streaming
                ? streamCall(client, payload, signal, onDelta, onThinkingDelta, onToolArgProgress, provider.defaultModel)
                : nonStreamCall(client, payload, signal, provider.defaultModel),
        { maxRetries, baseDelayMs, signal, onRetry }
    );
}

/** 从 CompletionUsage 取 prompt/completion tokens */
function toUsage(u: { prompt_tokens?: number; completion_tokens?: number } | undefined): LlmUsage | undefined {
    if (!u || u.prompt_tokens == null) return undefined;
    return { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens ?? 0 };
}

/** 非流式调用：整段返回，附 usage */
async function nonStreamCall(
    client: OpenAI,
    payload: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal | undefined,
    model: string
): Promise<LlmResult> {
    const resp = await client.chat.completions.create(payload, { signal });
    const message = resp.choices[0]?.message;
    if (!message) {
        throw new Error(
            `LLM returned no choices (model=${model}, finish_reason=${
                resp.choices[0]?.finish_reason ?? "n/a"
            })`
        );
    }
    // 非流式也可能带 reasoning_content（部分 provider 在 message 顶层）→ 累积进 _meta 落盘
    const reasoning = (message as unknown as Record<string, unknown>).reasoning_content;
    const _meta: MessageMeta | undefined =
        typeof reasoning === "string" && reasoning ? { reasoning } : undefined;
    return { ...message, usage: toUsage(resp.usage), _meta } as LlmResult;
}

/** 流式调用：累积 chunk 成完整 message，onDelta 发增量，abort 返回截断；末片带 usage */
async function streamCall(
    client: OpenAI,
    payload: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal | undefined,
    onDelta: ((delta: string) => void) | undefined,
    onThinkingDelta: ((delta: string) => void) | undefined,
    onToolArgProgress: ((info: { name?: string; bytes: number }) => void) | undefined,
    model: string
): Promise<LlmResult> {
    // include_usage：末片 chunk.usage 带 token 用量
    const stream = await client.chat.completions.create(
        { ...payload, stream: true, stream_options: { include_usage: true } },
        { signal }
    );
    let content = "";
    let reasoning = "";
    let usage: LlmUsage | undefined;
    const toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
    }> = [];
    const argBytes: number[] = []; // 每个 tool_call 累积的 arguments 字节数（心跳用）
    const argEmitted: number[] = []; // 上次发心跳时的字节数
    try {
        for await (const chunk of stream) {
            if (chunk.usage) usage = toUsage(chunk.usage);
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;
            // reasoning_content：部分思考型模型在思考阶段输出，字段位于 delta 扩展。
            // 累积进 reasoning（落盘用 _meta.reasoning），同时发实时 delta 回调（SSE 展示，不入盘）。
            if ((delta as Record<string, unknown>).reasoning_content) {
                const reasoningDelta = (delta as Record<string, unknown>)
                    .reasoning_content as string;
                reasoning += reasoningDelta;
                onThinkingDelta?.(reasoningDelta);
            }
            if (delta.content) {
                content += delta.content;
                onDelta?.(delta.content);
            }
            if (delta.tool_calls) {
                // streaming tool_calls 是分片 delta，按 index 拼装：首片含 id+name，后续片含 arguments 片段。
                // 联合类型里 custom 变体无 function 字段，cast 成带可选 function 的形态访问。
                for (const tcRaw of delta.tool_calls) {
                    const tc = tcRaw as {
                        index?: number;
                        id?: string;
                        function?: { name?: string; arguments?: string };
                    };
                    const idx = tc.index ?? 0;
                    if (!toolCalls[idx]) {
                        toolCalls[idx] = {
                            id: "",
                            type: "function",
                            function: { name: "", arguments: "" },
                        };
                        argBytes[idx] = 0;
                        argEmitted[idx] = 0;
                    }
                    if (tc.id) toolCalls[idx].id = tc.id;
                    if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
                    if (tc.function?.arguments) {
                        toolCalls[idx].function.arguments += tc.function.arguments;
                        argBytes[idx] += tc.function.arguments.length;
                        // 每 2KB 发一次心跳（只 bytes+name，不带 content）——
                        // 避免 LLM 流式输出大 tool_call.arguments（如大文件 write content）时事件流静默冻屏。
                        // 2KB 阈值：大 write 多次心跳、中等 write 也覆盖；小 write 流式快不冻屏本就不需。SPEC-022 B-002 / DEC-076。
                        if (
                            onToolArgProgress &&
                            argBytes[idx] - argEmitted[idx] >= 2048
                        ) {
                            argEmitted[idx] = argBytes[idx];
                            onToolArgProgress({
                                name: toolCalls[idx].function.name || undefined,
                                bytes: argBytes[idx],
                            });
                        }
                    }
                }
            }
        }
    } catch (err) {
        // abort：返回已累积的截断 message（content + 已收到的 reasoning 入 _meta，丢可能不完整的 tool_calls）
        if (signal?.aborted) {
            return {
                role: "assistant",
                content: content || null,
                _meta: reasoning ? { reasoning } : undefined,
            } as LlmResult;
        }
        throw err;
    }
    // 空响应（provider 错误/限流返回全空 chunks）
    if (!content && !toolCalls.length) {
        throw new Error(`LLM returned no content (model=${model})`);
    }
    return {
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
        usage,
        _meta: reasoning ? { reasoning } : undefined,
    } as LlmResult;
}
