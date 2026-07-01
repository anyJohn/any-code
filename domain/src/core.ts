import { ChatCompletionCreateParamsNonStreaming } from "openai/resources/index";
import { callLLM } from "./llm";
import { toolCall } from "./tools";
import { AgentLoopResult, ChatMessage } from "./type";
import { EventStream } from "./eventStream";
import { EventType } from "./type";

const eventStream = EventStream.getInstance();

/**
 * 核心代码，实现AgentLoop，通过循环让大模型持续使用工具
 * @param task
 * @param maxIterations
 * @returns
 */
export async function agentLoop(
    task: string,
    messages: ChatMessage[],
    maxIterations = 30,
    params?: Partial<ChatCompletionCreateParamsNonStreaming>,
    onMessage?: (msg: ChatMessage) => void | Promise<void>
): Promise<AgentLoopResult> {
    const userMsg: ChatMessage = {
        role: "user",
        content: task,
    };
    messages.push(userMsg);
    await onMessage?.(userMsg);
    for (let i = 0; i < maxIterations; i++) {
        eventStream.submit({
            type: EventType.ITERATION,
            message: `Iteration ${i + 1}/${maxIterations}`,
        });
        const msg = await callLLM(messages, params);
        messages.push(msg);
        await onMessage?.(msg);
        if (msg.content) {
            eventStream.submit({
                type: EventType.ASSISTANT,
                message: msg.content,
            });
        }
        if (!msg?.tool_calls) {
            return {
                result: msg.content || "",
                messages,
            };
        } else {
            const accessToolKit =
                params?.tools?.map((t) => (t as any)?.function?.name) ||
                undefined;
            const toolResults = await toolCall(msg.tool_calls, accessToolKit);
            messages.push(...toolResults);
            for (const tr of toolResults) {
                await onMessage?.(tr);
            }
        }
    }
    return {
        result: "Max iterations reached",
        messages,
    };
}
