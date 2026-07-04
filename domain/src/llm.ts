import {
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionMessage,
} from "openai/resources/index";
import { ChatMessage } from "./type";
import { Config } from "./config";
import OpenAI from "openai";
import { ToolKit } from "./tools";

/**
 * 调用 LLM
 * @param messages
 * @param params 创建 LLM 的参数
 * @returns
 */
export async function callLLM(
    messages: ChatMessage[],
    params?: Partial<ChatCompletionCreateParamsNonStreaming>,
    signal?: AbortSignal
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
    // signal 透传给底层 fetch：stop() 时 abort，正在进行的 LLM 调用会抛 AbortError，
    // agentLoop 捕获后视为中断返回，不再继续推理。
    const resp = await client.chat.completions.create(payload, { signal });
    const message = resp.choices[0]?.message;
    // choices 可能为空（provider 错误/限流返回空数组），此时不能返回 undefined，
    // 否则 core.ts 里 msg.content 会抛 TypeError 且类型契约失真
    if (!message) {
        throw new Error(
            `LLM returned no choices (model=${model}, finish_reason=${
                resp.choices[0]?.finish_reason ?? "n/a"
            })`
        );
    }
    return message;
}
