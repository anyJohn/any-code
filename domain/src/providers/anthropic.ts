import type { ChatMessage, LlmUsage, MessageMeta } from "../type";
import type { LlmProvider } from "../config";

/**
 * Anthropic Messages API 协议适配（AR-15）。
 *
 * 输入：与 OpenAI 路径相同的 ChatMessage 序列 + 工具 schema；输出：归一化 LlmResult
 * （content/tool_calls/usage/_meta.reasoning）——agentLoop、toolCall、压缩、事件流
 * 零改动复用。流式 SSE 事件映射：
 *   message_start.usage.input_tokens      → usage.prompt_tokens
 *   content_block_delta.text_delta        → onDelta / content
 *   content_block_delta.thinking_delta    → onThinkingDelta / _meta.reasoning
 *   content_block_delta.input_json_delta  → tool_calls[].arguments（onToolArgProgress）
 *   message_delta.usage.output_tokens     → usage.completion_tokens
 * 鉴权：x-api-key + anthropic-version；baseURL 缺省 https://api.anthropic.com。
 * max_tokens 为 Anthropic 必填：provider.maxOutputTokens ?? 8192。
 */

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8192;

export type AnthropicCallbacks = {
    onDelta?: (delta: string) => void;
    onThinkingDelta?: (delta: string) => void;
    onToolArgProgress?: (info: { name?: string; bytes: number }) => void;
};

export interface AnthropicResult {
    role: "assistant";
    content: string | null;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
    }>;
    usage?: LlmUsage;
    _meta?: MessageMeta;
}

/** ChatMessage → Anthropic messages（system 提取到顶层；tool 结果转 tool_result 块）。 */
export function toAnthropicMessages(messages: ChatMessage[]): {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: unknown }>;
} {
    const systemParts: string[] = [];
    const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];

    const contentToText = (c: unknown): string => {
        if (typeof c === "string") return c;
        if (Array.isArray(c)) {
            return c
                .map((p) =>
                    typeof p === "string"
                        ? p
                        : ((p as { text?: string })?.text ?? "")
                )
                .join("");
        }
        return "";
    };

    for (const raw of messages) {
        const m = raw as unknown as Record<string, unknown>;
        const role = m.role as string;
        if (role === "system") {
            systemParts.push(contentToText(m.content));
            continue;
        }
        if (role === "tool") {
            // OpenAI tool result → Anthropic user(tool_result) 块
            out.push({
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: m.tool_call_id ?? "",
                        content: contentToText(m.content),
                    },
                ],
            });
            continue;
        }
        if (role === "assistant") {
            const tcs = m.tool_calls as
                | Array<{
                      id: string;
                      function: { name: string; arguments: string };
                  }>
                | undefined;
            const blocks: unknown[] = [];
            const text = contentToText(m.content);
            if (text) blocks.push({ type: "text", text });
            for (const tc of tcs ?? []) {
                let input: unknown = {};
                try {
                    input = JSON.parse(tc.function.arguments || "{}");
                } catch {
                    input = {};
                }
                blocks.push({
                    type: "tool_use",
                    id: tc.id,
                    name: tc.function.name,
                    input,
                });
            }
            out.push({ role: "assistant", content: blocks.length ? blocks : text });
            continue;
        }
        out.push({ role: role === "assistant" ? "assistant" : "user", content: m.content });
    }
    return { system: systemParts.join("\n\n"), messages: out };
}

function buildBody(
    messages: ChatMessage[],
    provider: LlmProvider,
    tools:
        | Array<{ function: { name: string; description?: string; parameters?: unknown } }>
        | undefined,
    maxTokens: number,
    stream: boolean
): Record<string, unknown> {
    const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
    const body: Record<string, unknown> = {
        model: provider.defaultModel,
        max_tokens: maxTokens,
        messages: anthropicMessages,
        stream,
    };
    if (system) body.system = system;
    if (tools?.length) {
        body.tools = tools.map((t) => ({
            name: t.function.name,
            description: t.function.description ?? "",
            input_schema: t.function.parameters ?? { type: "object", properties: {} },
        }));
    }
    return body;
}

function headers(provider: LlmProvider): Record<string, string> {
    return {
        "content-type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
    };
}

function baseUrl(provider: LlmProvider): string {
    return (provider.baseURL || "https://api.anthropic.com").replace(/\/$/, "");
}

/** 非流式调用：content blocks → 归一化结果。 */
async function nonStreamCall(
    body: Record<string, unknown>,
    provider: LlmProvider,
    signal: AbortSignal | undefined
): Promise<AnthropicResult> {
    const resp = await fetch(`${baseUrl(provider)}/v1/messages`, {
        method: "POST",
        headers: headers(provider),
        body: JSON.stringify(body),
        signal,
    });
    if (!resp.ok) {
        throw new Error(
            `Anthropic API ${resp.status}: ${(await resp.text()).slice(0, 300)}`
        );
    }
    const data = (await resp.json()) as {
        content?: Array<{
            type: string;
            text?: string;
            id?: string;
            name?: string;
            input?: unknown;
        }>;
        usage?: { input_tokens?: number; output_tokens?: number };
    };
    return fromContentBlocks(data.content ?? [], {
        prompt: data.usage?.input_tokens,
        completion: data.usage?.output_tokens,
    });
}

/** content blocks → 归一化结果（流式/非流式共用）。 */
function fromContentBlocks(
    blocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>,
    usage: { prompt?: number; completion?: number }
): AnthropicResult {
    let content = "";
    const toolCalls: AnthropicResult["tool_calls"] = [];
    for (const b of blocks) {
        if (b.type === "text") content += b.text ?? "";
        if (b.type === "tool_use") {
            toolCalls.push({
                id: b.id ?? "",
                type: "function",
                function: {
                    name: b.name ?? "",
                    arguments: JSON.stringify(b.input ?? {}),
                },
            });
        }
    }
    const usageOut: LlmUsage | undefined =
        usage.prompt != null || usage.completion != null
            ? { prompt_tokens: usage.prompt ?? 0, completion_tokens: usage.completion ?? 0 }
            : undefined;
    return {
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
        usage: usageOut,
    };
}

/** 流式调用：SSE 事件流 → 归一化结果（onDelta/onThinkingDelta/工具参数心跳）。 */
async function streamCall(
    body: Record<string, unknown>,
    provider: LlmProvider,
    signal: AbortSignal | undefined,
    cb: AnthropicCallbacks
): Promise<AnthropicResult> {
    const resp = await fetch(`${baseUrl(provider)}/v1/messages`, {
        method: "POST",
        headers: headers(provider),
        body: JSON.stringify(body),
        signal,
    });
    if (!resp.ok || !resp.body) {
        throw new Error(
            `Anthropic API ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`
        );
    }

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let content = "";
    let reasoning = "";
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    // 进行中的 tool_use 块（按 index 聚合 input_json_delta）
    const openTools = new Map<number, { id: string; name: string; json: string }>();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = "";
            let data = "";
            for (const line of frame.split("\n")) {
                if (line.startsWith("event:")) event = line.slice(6).trim();
                else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;
            let payload: Record<string, unknown>;
            try {
                payload = JSON.parse(data) as Record<string, unknown>;
            } catch {
                continue;
            }
            const type = event || (payload.type as string);
            if (type === "message_start") {
                const u = (payload.message as { usage?: { input_tokens?: number } })
                    ?.usage;
                promptTokens = u?.input_tokens;
            } else if (type === "content_block_start") {
                const b = payload.content_block as {
                    type?: string;
                    id?: string;
                    name?: string;
                };
                if (b?.type === "tool_use") {
                    openTools.set(payload.index as number, {
                        id: b.id ?? "",
                        name: b.name ?? "",
                        json: "",
                    });
                }
            } else if (type === "content_block_delta") {
                const d = payload.delta as {
                    type?: string;
                    text?: string;
                    thinking?: string;
                    partial_json?: string;
                };
                if (d?.type === "text_delta" && d.text) {
                    content += d.text;
                    cb.onDelta?.(d.text);
                } else if (d?.type === "thinking_delta" && d.thinking) {
                    reasoning += d.thinking;
                    cb.onThinkingDelta?.(d.thinking);
                } else if (d?.type === "input_json_delta") {
                    const t = openTools.get(payload.index as number);
                    if (t) {
                        t.json += d.partial_json ?? "";
                        cb.onToolArgProgress?.({
                            name: t.name || undefined,
                            bytes: t.json.length,
                        });
                    }
                }
            } else if (type === "message_delta") {
                const u = payload.usage as { output_tokens?: number } | undefined;
                if (u?.output_tokens != null) completionTokens = u.output_tokens;
            }
        }
    }

    const toolCalls: AnthropicResult["tool_calls"] = [...openTools.values()].map(
        (t) => ({
            id: t.id,
            type: "function" as const,
            function: { name: t.name, arguments: t.json || "{}" },
        })
    );
    const usage: LlmUsage | undefined =
        promptTokens != null || completionTokens != null
            ? {
                  prompt_tokens: promptTokens ?? 0,
                  completion_tokens: completionTokens ?? 0,
              }
            : undefined;
    if (!content && !toolCalls.length) {
        throw new Error(
            `LLM returned no content (model=${provider.defaultModel})`
        );
    }
    const result: AnthropicResult = {
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
        usage,
        _meta: reasoning ? ({ reasoning } as MessageMeta) : undefined,
    };
    return result;
}

/**
 * Anthropic 调用入口（供 callLLM 按 provider.protocol 分派）。
 * params.tools 来自调用方（OpenAI ChatCompletionTool 形状）——映射为 Anthropic tools。
 */
export async function anthropicCall(
    messages: ChatMessage[],
    params:
        | (Partial<{
              tools: Array<{
                  function: { name: string; description?: string; parameters?: unknown };
              }>;
              max_tokens?: number;
          }> & Record<string, unknown>)
        | undefined,
    signal: AbortSignal | undefined,
    provider: LlmProvider,
    cb: AnthropicCallbacks
): Promise<AnthropicResult> {
    const maxTokens =
        (params?.max_tokens as number | undefined) ??
        provider.maxOutputTokens ??
        DEFAULT_MAX_TOKENS;
    const tools = params?.tools;
    const stream = provider.streaming;
    const body = buildBody(messages, provider, tools, maxTokens, stream);
    if (stream) {
        return streamCall(body, provider, signal, cb);
    }
    return nonStreamCall(body, provider, signal);
}
