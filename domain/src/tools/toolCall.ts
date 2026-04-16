import { ChatCompletionMessageToolCall } from "openai/resources/index";
import { ChatMessage } from "../type";
import { ToolsMap } from "./functions";
import { EventStream, EventType } from "../eventStream";

const eventStream = EventStream.getInstance();

export async function toolCall(
  tooCalls: ChatCompletionMessageToolCall[],
  accessToolKit?: string[],
): Promise<ChatMessage[]> {
  const result: ChatMessage[] = [];
  for (const toolCall of tooCalls) {
    if (toolCall.type !== "function") {
      return [
        {
          role: "tool",
          tool_call_id: toolCall.id,
          content: `[Error] Unsupported tool call type: ${toolCall.type}`,
        },
      ];
    }
    const funcName: string = toolCall.function.name;

    if (accessToolKit && !accessToolKit.includes(funcName)) {
      return [
        {
          role: "tool",
          tool_call_id: toolCall.id,
          content: `[Error] Access denied for tool: ${funcName}`,
        },
      ];
    }

    if (typeof ToolsMap[funcName] !== "function") {
      return [
        {
          role: "tool",
          tool_call_id: toolCall.id,
          content: `[Error] Function not found: ${funcName}`,
        },
      ];
    }
    const args = JSON.parse(toolCall.function.arguments || "{}");
    const toolOutput = await ToolsMap[funcName](args);
    eventStream.submit({ type: EventType.TOOL, message: `Tool call success: ${funcName}`, data: { name: funcName, args } });
    result.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: toolOutput,
    });
  }
  return result;
}
