import OpenAI from "openai";
import fs from "fs/promises";

interface WriteArgs {
  filePath: string;
  content: string;
}

export const writeSchema: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "write_file",
    description: "Write content to a file",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The path to the file to write",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["filePath", "content"],
    },
  },
};

export const writeFunc = async (args: WriteArgs): Promise<string> => {
  try {
    await fs.writeFile(args.filePath, args.content, "utf-8");
    return `Successfully wrote ${args.content.length} characters to ${args.filePath}`;
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
};
