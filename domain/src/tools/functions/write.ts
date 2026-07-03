import fs from "fs/promises";
import path from "path";
import { EventStream } from "../../eventStream";
import { EventType } from "../../type";
import type { Workspace } from "../../workspace";
import { resolvePath } from "../../workspace";

const eventStream = EventStream.getInstance();

interface WriteArgs {
    filePath: string;
    content: string;
}

export const writeFunc = async (
    args: WriteArgs,
    workspace: Workspace
): Promise<string> => {
    try {
        eventStream.submit({
            type: EventType.TOOL,
            message: `Writing to file`,
            data: {
                filePath: args.filePath,
                contentLength: args.content.length,
            },
        });
        const filePath = resolvePath(workspace, args.filePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content, "utf-8");
        return `Successfully wrote ${args.content.length} characters to ${args.filePath}`;
    } catch (error) {
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};
