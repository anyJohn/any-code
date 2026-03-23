import OpenAI from "openai";
import { exec } from "child_process";
import { promisify } from "util";

export const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "execute_bash",
      description: "Execute a bash command on the system",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to execute",
          },
        },
        required: ["command"],
      },
    },
  },
];

export const toolsMap: { [k: string]: (arg: string) => Promise<string> } = {
  execute_bash: async (command: string): Promise<string> => {
    const execAsync = promisify(exec);
    try {
      const { stdout, stderr } = await execAsync(command);
      return stdout + stderr;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return `Error: ${String(error)}`;
    }
  },
};
