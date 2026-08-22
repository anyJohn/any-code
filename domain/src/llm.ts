import {
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionMessage,
} from "openai/resources/index";
import { ChatMessage } from "./type";
import { Config } from "./config";
import OpenAI from "openai";
import { ToolKit } from "./tools";

/**
 * 调用 LLM（流式）。消费 ChatCompletionChunk 流，累积成完整 assistant message：
 * content 拼接 + tool_calls 按 index 拼装。
 * onDelta 在每段 text delta 到达时触发（agentLoop 据此发 ASSISTANT_DELTA 事件）。
 * signal aborted 时返回已累积的截断 message（仅 content，丢 tool_calls），不抛——
 * 让 agentLoop 截断定稿 + 返回 [stopped]，已发 delta 已展示不丢。
 */
export async function callLLM(
    messages: ChatMessage[],
    params?: Partial<ChatCompletionCreateParamsNonStreaming>,
    signal?: AbortSignal,
    onDelta?: (delta: string) => void
): Promise<ChatCompletionMessage> {
    const config = new Config();
    const { apiKey, baseURL, model } = config;
    if (!apiKey) {
        console.error("Error: OPENAI_API_KEY environment variable is required");
        process.exit(1);
    }
    const client = new OpenAI({
        apiKey,
        baseURL,
    });
    const payload: ChatCompletionCreateParamsNonStreaming = {
        model,
        messages,
        tools: ToolKit.readOnlyTools.map((t) => t.schema), // 默认只读权限（schema）
        ...params,
    };
    // signal 透传：stop() abort 时正在进行的流式生成会抛 AbortError，下方 catch 兜底返回截断。
    const stream = await client.chat.completions.create(
        { ...payload, stream: true },
        { signal }
    );
    let content = "";
    const toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
    }> = [];
    try {
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;
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
            } as ChatCompletionMessage;
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
    } as ChatCompletionMessage;
}
