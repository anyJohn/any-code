import { glob } from "glob";
import { EventStream } from "../../eventStream";
import { EventType } from "../../type";
import type { Workspace } from "../../workspace";
import { resolvePath } from "../../workspace";

const eventStream = EventStream.getInstance();

interface GlobArgs {
    pattern: string;
    path?: string;
}

export const globFunc = async (
    args: GlobArgs,
    workspace: Workspace
): Promise<string> => {
    try {
        const cwd = args.path
            ? resolvePath(workspace, args.path)
            : workspace.rootPath;
        eventStream.submit({
            type: EventType.TOOL,
            message: `Glob search`,
            data: { pattern: args.pattern, path: cwd },
        });
        const files = await glob(args.pattern, { cwd });

        if (files.length === 0) {
            return `No files found matching pattern: ${args.pattern}`;
        }

        return files.sort().join("\n");
    } catch (error) {
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};
