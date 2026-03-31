import { promisify } from "util";
import { exec } from "child_process";

interface ExecuteBashArgs {
  command: string;
}

export const executeBashFunc = async (
  args: ExecuteBashArgs,
): Promise<string> => {
  const execAsync = promisify(exec);
  try {
    console.log(`\n[Tool Call] Bash: ${args.command}`);
    const { stdout, stderr } = await execAsync(args.command);
    return stdout + stderr;
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
};
