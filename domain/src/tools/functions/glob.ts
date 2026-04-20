import { glob } from "glob";
import { EventStream, EventType } from "../../eventStream";

const eventStream = EventStream.getInstance();

interface GlobArgs {
    pattern: string;
    path?: string;
}

export const globFunc = async (args: GlobArgs): Promise<string> => {
    try {
        eventStream.submit({
            type: EventType.TOOL,
            message: `Glob search`,
            data: { pattern: args.pattern, path: args.path || process.cwd() },
        });
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
