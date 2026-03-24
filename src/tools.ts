import OpenAI from "openai";
import { executeBashSchema, executeBashFunc } from "./tools/executeBash";
import { readFileSchema, readFileFunc } from "./tools/readFile";
import { editFileSchema, editFileFunc } from "./tools/editFile";
import { writeFileSchema, writeFileFunc } from "./tools/writeFile";

export const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  executeBashSchema,
  readFileSchema,
  editFileSchema,
  writeFileSchema,
];

export const toolsMap: { [k: string]: (args: any) => Promise<string> } = {
  execute_bash: executeBashFunc,
  read_file: readFileFunc,
  edit_file: editFileFunc,
  write_file: writeFileFunc,
};
