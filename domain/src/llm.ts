import {
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionMessage,
} from "openai/resources/index";
import { ChatMessage, type LlmUsage } from "./type";
import type { LlmProvider } from "./config";
import OpenAI from "openai";
import { ToolKit } from "./tools";

type LlmResult = ChatCompletionMessage & { usage?: LlmUsage };

/**
 * 调用 LLM。按传入 provider 的 streaming 决定流式 / 非流式（provider 粒度开关）。
 * 流式：消费 chunk 累积成完整 message（content 拼接 + tool_calls 按 index 拼装），onDelta 发增量；
 *       onThinkingDelta 发 reasoning_content 增量（部分模型如 DeepSeek R1 支持）；
 *       abort 时返回已累积的截断 message（仅 content）不抛。
 * 非流式：整段返回 choices[0].message。
 * usage：捕获响应 token 用量（非流式 resp.usage；流式 stream_options.include_usage 末片）附在返回 message 上。
 * llm 由调用方（AnyAgent 从 config.yaml 解析）传入，必填。
 */
export async function callLLM(
    messages: ChatMessage[],
    params?: Partial<ChatCompletionCreateParamsNonStreaming>,
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
    llm?: LlmProvider,
    onThinkingDelta?: (delta: string) => void
): Promise<LlmResult> {
    if (!llm) {
        throw new Error("callLLM 需要 provider 配置（由 AnyAgent 从 config.yaml 解析传入）");
    }
    const provider = llm;
    if (!provider.apiKey) {
        console.error("Error: provider.apiKey 为空，请在 .anycode/config.yaml 配置 apiKey");
        process.exit(1);
    }
    const client = new OpenAI({
        apiKey: provider.apiKey,
        baseURL: provider.baseURL,
    });
    const payload: ChatCompletionCreateParamsNonStreaming = {
        model: provider.defaultModel,
        messages,
        tools: ToolKit.readOnlyTools.map((t) => t.schema), // 默认只读权限（schema）
        ...params,
    };
    // signal 透传：stop() abort 时流式生成抛 AbortError（下方 catch 兜底）/ 非流式 fetch 取消。
    if (provider.streaming) {
        return streamCall(client, payload, signal, onDelta, onThinkingDelta, provider.defaultModel);
    }
    return nonStreamCall(client, payload, signal, provider.defaultModel);
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
    return { ...message, usage: toUsage(resp.usage) } as LlmResult;
}

/** 流式调用：累积 chunk 成完整 message，onDelta 发增量，abort 返回截断；末片带 usage */
async function streamCall(
    client: OpenAI,
    payload: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal | undefined,
    onDelta: ((delta: string) => void) | undefined,
    onThinkingDelta: ((delta: string) => void) | undefined,
    model: string
): Promise<LlmResult> {
    // include_usage：末片 chunk.usage 带 token 用量
    const stream = await client.chat.completions.create(
        { ...payload, stream: true, stream_options: { include_usage: true } },
        { signal }
    );
    let content = "";
    let usage: LlmUsage | undefined;
    const toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
    }> = [];
    try {
        for await (const chunk of stream) {
            if (chunk.usage) usage = toUsage(chunk.usage);
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;
            // reasoning_content：部分模型（如 DeepSeek R1）在思考阶段输出，字段位于 delta 扩展
            if ((delta as Record<string, unknown>).reasoning_content) {
                const reasoningDelta = (delta as Record<string, unknown>)
                    .reasoning_content as string;
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
                    }
                    if (tc.id) toolCalls[idx].id = tc.id;
                    if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
                    if (tc.function?.arguments)
                        toolCalls[idx].function.arguments += tc.function.arguments;
                }
            }
        }
    } catch (err) {
        // abort：返回已累积的截断 message（仅 content，丢可能不完整的 tool_calls）
        if (signal?.aborted) {
            return {
                role: "assistant",
                content: content || null,
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
    } as LlmResult;
}
