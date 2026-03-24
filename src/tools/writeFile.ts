import OpenAI from "openai";
import fs from "fs/promises";

interface WriteFileArgs {
  filePath: string;
  content: string;
}

export const writeFileSchema: OpenAI.Chat.Completions.ChatCompletionTool = {
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

export const writeFileFunc = async (args: WriteFileArgs): Promise<string> => {
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
