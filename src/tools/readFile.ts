import OpenAI from "openai";
import fs from "fs/promises";

interface ReadFileArgs {
  filePath: string;
  offset?: number;
  limit?: number;
}

export const readFileSchema: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read the content of a file with pagination support",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The path to the file to read",
        },
        offset: {
          type: "number",
          description: "Starting character position (default: 0)",
        },
        limit: {
          type: "number",
          description: "Maximum number of characters to read (default: 8000)",
        },
      },
      required: ["filePath"],
    },
  },
};

export const readFileFunc = async (args: ReadFileArgs): Promise<string> => {
  try {
    const { filePath, offset = 0, limit = 8000 } = args;
    const content = await fs.readFile(filePath, "utf-8");
    const totalLength = content.length;
    const start = Math.max(0, offset);
    const end = Math.min(start + limit, totalLength);
    const slicedContent = content.slice(start, end);

    if (end < totalLength) {
      return `${slicedContent}\n\n[... Truncated - ${totalLength - end} more characters available. Use offset=${end} to continue reading.]`;
    }
    if (start > 0) {
      return `[... Starting from offset ${start} of ${totalLength} total characters]\n\n${slicedContent}`;
    }
    return slicedContent;
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
};
