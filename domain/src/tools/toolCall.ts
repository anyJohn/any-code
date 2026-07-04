import { ChatCompletionMessageToolCall } from "openai/resources/index";
import { ChatMessage } from "../type";
import { EventType } from "../type";
import type { ToolContext } from "../context";
import type { Tool } from "./index";

/**
 * 工具调用分发。在传入的 tools 列表里按名查 handler（不再有全局 ToolsMap）。
 * tools 列表本身就是该 agent 的可用工具集——不在列表里 = 不可用。
 */
export async function toolCall(
    tooCalls: ChatCompletionMessageToolCall[],
    ctx: ToolContext,
    tools: Tool[]
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

        const toolOutput = await tool.handler(args, ctx);
        ctx.eventStream.submit({
            type: EventType.TOOL,
            message: `Tool call success: ${funcName}`,
            data: { name: funcName, args },
        });
        result.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolOutput,
        });
    }
    return result;
}
