import fs from "fs/promises";
import type { ToolContext } from "../../context";
import { resolvePath } from "../../workspace";

interface ReadArgs {
    filePath: string;
    offset?: number;
    limit?: number;
}

export const readFunc = async (
    args: ReadArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    try {
        const { offset = 0, limit = 8000 } = args;
        const filePath = resolvePath(workspace, args.filePath);
        const content = await fs.readFile(filePath, "utf-8");
        const totalLength = content.length;
        const start = Math.max(0, offset);
        const end = Math.min(start + limit, totalLength);
        const slicedContent = content.slice(start, end);

        const contentBeforeStart = content.slice(0, start);
        const lineNumber = (contentBeforeStart.match(/\n/g) || []).length + 1;

        const lines = slicedContent.split("\n");
        const contentWithLineNumbers = lines
            .map((line, index) => `${lineNumber + index}\t${line}`)
            .join("\n");

        if (end < totalLength) {
            return `${contentWithLineNumbers}\n\n[... Truncated - ${
                totalLength - end
            } more characters available. Use offset=${end} to continue reading.]`;
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
