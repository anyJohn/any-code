import fs from "fs/promises";
import { EventStream } from "../../eventStream";
import { EventType } from "../../type";

const eventStream = EventStream.getInstance();

interface WriteArgs {
    filePath: string;
    content: string;
}

export const writeFunc = async (args: WriteArgs): Promise<string> => {
    try {
        eventStream.submit({
            type: EventType.TOOL,
            message: `Writing to file`,
            data: {
                filePath: args.filePath,
                contentLength: args.content.length,
            },
        });
        await fs.writeFile(args.filePath, args.content, "utf-8");
        return `Successfully wrote ${args.content.length} characters to ${args.filePath}`;
    } catch (error) {
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};
