import { ChatCompletionMessageToolCall } from "openai/resources/index";
import { ChatMessage } from "../type";
import { ToolsMap } from "./functions";
import { EventStream } from "../eventStream";
import { EventType } from "../type";
import type { Workspace } from "../workspace";

const eventStream = EventStream.getInstance();

export async function toolCall(
    tooCalls: ChatCompletionMessageToolCall[],
    accessToolKit: string[] | undefined,
    workspace: Workspace
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

        if (accessToolKit && !accessToolKit.includes(funcName)) {
            result.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `[Error] Access denied for tool: ${funcName}`,
            });
            continue;
        }

        if (typeof ToolsMap[funcName] !== "function") {
            result.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `[Error] Function not found: ${funcName}`,
            });
            continue;
        }

        // LLM 可能返回非法 JSON 参数，parse 失败时回传错误让模型自纠，而不是整个 agentLoop 崩掉
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

        const toolOutput = await ToolsMap[funcName](args, workspace);
        eventStream.submit({
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
