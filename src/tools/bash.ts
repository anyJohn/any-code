import OpenAI from "openai";
import { promisify } from "util";
import { exec } from "child_process";

interface ExecuteBashArgs {
  command: string;
}

export const executeBashSchema: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "execute_bash",
    description: "Execute a bash command on the system.",
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
};

export const executeBashFunc = async (args: ExecuteBashArgs): Promise<string> => {
  const execAsync = promisify(exec);
  try {
    const { stdout, stderr } = await execAsync(args.command);
    return stdout + stderr;
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
};
