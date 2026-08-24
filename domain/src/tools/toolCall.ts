import { ChatCompletionMessageToolCall } from "openai/resources/index";
import { ChatMessage } from "../type";
import { EventType } from "../type";
import type { ToolContext } from "../context";
import type { Tool } from "./index";

/**
 * 工具调用分发。在传入的 tools 列表里按名查 handler。
 * tools 列表本身就是该 agent 的可用工具集——不在列表里 = 不可用。
 */
export async function toolCall(
    tooCalls: ChatCompletionMessageToolCall[],
    ctx: ToolContext,
    tools: Tool[],
    turnId?: string
): Promise<ChatMessage[]> {
    const result: ChatMessage[] = [];
    for (const toolCall of tooCalls) {
        if (toolCall.type !== "function") {
            // 用 continue 而非 return：一个异常 tool call 不应丢弃批次内其它结果
            result.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `[Error] Unsupported tool call type: ${toolCall.type}`,
            });
            continue;
        }
        const funcName: string = toolCall.function.name;

        const tool = tools.find(
            (t) =>
                (t.schema as { function?: { name: string } }).function?.name ===
                funcName
        );
        if (!tool) {
            result.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `[Error] Function not found: ${funcName}`,
            });
            continue;
        }

        // LLM 可能返回非法 JSON 参数，parse 失败时回传错误让模型自纠
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
            result.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `[Error] Invalid JSON arguments for tool ${funcName}: ${toolCall.function.arguments}`,
            });
            continue;
        }

        // TOOL_START：handler 执行前立即发（前端显"执行中"卡片，消除假死）。
        // emitProgress：注入流式回调，bash 等工具逐 chunk 上抛 TOOL_PROGRESS（turnId 闭包绑定）。
        ctx.emitProgress = (chunk: string) => {
            ctx.eventStream.submit({
                type: EventType.TOOL_PROGRESS,
                message: chunk,
                turnId,
            });
        };
        ctx.eventStream.submit({
            type: EventType.TOOL_START,
            message: funcName,
            data: { name: funcName, args },
            turnId,
        });

        let toolOutput: string;
        try {
            toolOutput = await tool.handler(args, ctx);
        } finally {
            // 清理注入的回调，避免后续 tool 复用泄漏 / 误发 progress
            ctx.emitProgress = undefined;
        }
        // 一次工具调用的完整画像：name + args + result 都进事件流。
        // 这是未来权限/黑白名单/bypass 的天然拦截点——在此处做策略决策即可。
        ctx.eventStream.submit({
            type: EventType.TOOL,
            message: funcName,
            data: { name: funcName, args, result: toolOutput },
            turnId,
        });
        result.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolOutput,
        });
    }
    return result;
}
