import { promisify } from "util";
import { exec } from "child_process";
import { EventStream } from "../../eventStream";
import { EventType } from "../../type";

const eventStream = EventStream.getInstance();

interface ExecuteBashArgs {
    command: string;
}

export const executeBashFunc = async (
    args: ExecuteBashArgs
): Promise<string> => {
    const execAsync = promisify(exec);
    try {
        eventStream.submit({
            type: EventType.TOOL,
            message: `Executing bash command`,
            data: { command: args.command },
        });
        const { stdout, stderr } = await execAsync(args.command);
        return stdout + stderr;
    } catch (error) {
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};
