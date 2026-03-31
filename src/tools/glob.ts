import OpenAI from "openai";
import { glob } from "glob";

interface GlobArgs {
  pattern: string;
  path?: string;
}

export const globSchema: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "glob",
    description: "Find files matching a glob pattern (like **/*.ts, src/**/*.json, etc.)",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The glob pattern to match (e.g., **/*.ts, src/**/*.json)",
        },
        path: {
          type: "string",
          description: "The directory to search in (default: current working directory)",
        },
      },
      required: ["pattern"],
    },
  },
};

export const globFunc = async (args: GlobArgs): Promise<string> => {
  try {
    const { pattern, path } = args;
    const options = path ? { cwd: path } : undefined;
    const files = await glob(pattern, options);

    if (files.length === 0) {
      return `No files found matching pattern: ${pattern}`;
    }

    return files.sort().join("\n");
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
};
