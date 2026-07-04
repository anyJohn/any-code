import { ChatCompletionCreateParamsNonStreaming } from "openai/resources/index";
import { randomUUID } from "node:crypto";
import { callLLM } from "./llm";
import { toolCall } from "./tools/toolCall";
import { AgentLoopResult, ChatMessage } from "./type";
import { EventType } from "./type";
import type { ToolContext } from "./context";
import type { Tool } from "./tools";

/**
 * 核心代码，实现AgentLoop，通过循环让大模型持续使用工具。
 * ctx 贯穿（eventStream + workspace）；tools 是该 agent 的工具集（schema + handler）。
 */
export async function agentLoop(
    task: string,
    messages: ChatMessage[],
    maxIterations: number | undefined,
    params: Partial<ChatCompletionCreateParamsNonStreaming> | undefined,
    onMessage: ((msg: ChatMessage) => void | Promise<void>) | undefined,
    ctx: ToolContext,
    tools: Tool[]
): Promise<AgentLoopResult> {
    const maxIter = maxIterations ?? 30;
    const userMsg: ChatMessage = {
        role: "user",
        content: task,
    };
    messages.push(userMsg);
    await onMessage?.(userMsg);
    for (let i = 0; i < maxIter; i++) {
        // 同一回合的 ITERATION/ASSISTANT/TOOL 事件共用 turnId,
        // 前端据此把 "assistant 文本 + 紧随的工具调用" 组成块状展示。
        const turnId = randomUUID();
        ctx.eventStream.submit({
            type: EventType.ITERATION,
            message: `Iteration ${i + 1}/${maxIter}`,
            turnId,
        });
        const msg = await callLLM(messages, {
            ...params,
            tools: tools.map((t) => t.schema),
        });
        messages.push(msg);
        await onMessage?.(msg);
        if (msg.content) {
            ctx.eventStream.submit({
                type: EventType.ASSISTANT,
                message: msg.content,
                turnId,
            });
        }
        if (!msg?.tool_calls) {
            return {
                result: msg.content || "",
                messages,
            };
        } else {
            const toolResults = await toolCall(msg.tool_calls, ctx, tools, turnId);
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
