import { executeBashSchema, executeBashFunc } from "./bash";
import { readSchema, readFunc } from "./read";
import { editSchema, editFunc } from "./edit";
import { writeSchema, writeFunc } from "./write";
import { exploreSchema, exploreFunc } from "./explore";
import { planSchema, planFunc } from "./plan";
import { globSchema, globFunc } from "./glob";
import { grepSchema, grepFunc } from "./grep";
import {
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources/index";
import { ChatMessage } from "../type";

export enum ToolName {
  Bash = "bash",
  Read = "read",
  Edit = "edit",
  Write = "write",
  Explore = "explore",
  Plan = "plan",
  Glob = "glob",
  Grep = "grep",
}

export const tools: ChatCompletionTool[] = [
  executeBashSchema,
  readSchema,
  editSchema,
  writeSchema,
  exploreSchema,
  planSchema,
  globSchema,
  grepSchema,
];

export const readOnlyTools: ChatCompletionTool[] = [
  readSchema,
  exploreSchema,
  globSchema,
  grepSchema,
];

export const executeTools: ChatCompletionTool[] = [
  executeBashSchema,
  readSchema,
  editSchema,
  writeSchema,
  exploreSchema,
  globSchema,
  grepSchema,
];

export const toolsMap: { [k: string]: (args: any) => Promise<string> } = {
  [ToolName.Bash]: executeBashFunc,
  [ToolName.Read]: readFunc,
  [ToolName.Edit]: editFunc,
  [ToolName.Write]: writeFunc,
  [ToolName.Explore]: exploreFunc,
  [ToolName.Plan]: planFunc,
  [ToolName.Glob]: globFunc,
  [ToolName.Grep]: grepFunc,
};

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

    if (typeof toolsMap[funcName] !== "function") {
      return [
        {
          role: "tool",
          tool_call_id: toolCall.id,
          content: `[Error] Function not found: ${funcName}`,
        },
      ];
    }
    const args = JSON.parse(toolCall.function.arguments || "{}");
    const toolOutput = await toolsMap[funcName](args);
    console.log(`[Tool Call] Success.`);
    result.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: toolOutput,
    });
  }
  return result;
}
