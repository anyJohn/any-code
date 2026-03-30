import OpenAI from "openai";
import { executeBashSchema, executeBashFunc } from "./executeBash";
import { readSchema, readFunc } from "./read";
import { editSchema, editFunc } from "./edit";
import { writeSchema, writeFunc } from "./write";
import { exploreSchema, exploreFunc } from "./explore";
import { ChatCompletionMessageToolCall } from "openai/resources/index";
import { ChatMessage } from "../type";

export const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  executeBashSchema,
  readSchema,
  editSchema,
  writeSchema,
  exploreSchema,
];

export const readOnlyTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  readSchema,
  exploreSchema,
];

export const toolsMap: { [k: string]: (args: any) => Promise<string> } = {
  execute_bash: executeBashFunc,
  read_file: readFunc,
  edit_file: editFunc,
  write_file: writeFunc,
  explore_directory: exploreFunc,
};

export async function toolCall(
  tooCalls: ChatCompletionMessageToolCall[],
): Promise<ChatMessage[]> {
  const result: ChatMessage[] = [];
  for (const toolCall of tooCalls) {
    if (toolCall.type === "function") {
      const funcName: string = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || "{}");
      console.log(`\n[Tool Call] ${funcName}:`, args);
      let toolOutput = "";
      if (typeof toolsMap[funcName] === "function") {
        toolOutput = await toolsMap[funcName](args);
        console.log(`[Tool Call] Success.`);
      } else {
        toolOutput = `[Error] ${toolOutput}`;
        console.log(`[Error] ${toolOutput}`);
      }
      
      result.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolOutput,
      });
    }
  }
  return result;
}
