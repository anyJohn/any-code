import fs from "fs/promises";
import path from "path";
import type { ToolContext } from "../../context";
import { resolvePath } from "../../workspace";

interface WriteArgs {
    filePath: string;
    content: string;
}

export const writeFunc = async (
    args: WriteArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    try {
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
