import OpenAI from "openai";
import fs from "fs/promises";
import { ToolName } from ".";

interface ReadArgs {
  filePath: string;
  offset?: number;
  limit?: number;
}

export const readSchema: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: ToolName.Read,
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

export const readFunc = async (args: ReadArgs): Promise<string> => {
  try {
    console.log(
      `[Tool Call] Reading file: ${args.filePath}, Offset: ${args.offset || 0}, Limit: ${args.limit || 8000}`,
    );
    const { filePath, offset = 0, limit = 8000 } = args;
    const content = await fs.readFile(filePath, "utf-8");
    const totalLength = content.length;
    const start = Math.max(0, offset);
    const end = Math.min(start + limit, totalLength);
    const slicedContent = content.slice(start, end);

    // 获取行号信息
    const contentBeforeStart = content.slice(0, start);
    const lineNumber = (contentBeforeStart.match(/\n/g) || []).length + 1;

    // 添加行号
    const lines = slicedContent.split("\n");
    const contentWithLineNumbers = lines
      .map((line, index) => `${lineNumber + index}\t${line}`)
      .join("\n");

    if (end < totalLength) {
      return `${contentWithLineNumbers}\n\n[... Truncated - ${totalLength - end} more characters available. Use offset=${end} to continue reading.]`;
    }
    if (start > 0) {
      return `[... Starting from offset ${start} (line ${lineNumber}) of ${totalLength} total characters]\n\n${contentWithLineNumbers}`;
    }
    return contentWithLineNumbers;
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
};
