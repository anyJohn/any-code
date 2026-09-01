import fs from "fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { ToolContext } from "../../context";
import { resolvePath } from "../../workspace";
import { stalenessWarning, recordMtime } from "./fileState";

interface WriteArgs {
    filePath: string;
    content: string;
}

/**
 * 整文件写入。原子写（同目录 temp + rename，崩溃不留半写）。
 * staleness：read 记过 mtime 且当前 mtime 漂移 → result 警告（不阻断）。SPEC-022 B-005/B-006。
 */
export const writeFunc = async (
    args: WriteArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    let tmp: string | null = null;
    try {
        const filePath = resolvePath(workspace, args.filePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });

        const stalenessWarn = stalenessWarning(
            ctx.fileState,
            filePath,
            "覆写"
        );

        // 原子写：同目录 temp + rename，同文件系统原子发布，崩溃不留半写
        tmp = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
        await fs.writeFile(tmp, args.content, "utf-8");
        await fs.rename(tmp, filePath);
        tmp = null; // rename 成功，无需清理

        recordMtime(ctx.fileState, filePath);
        return `Successfully wrote ${args.content.length} characters to ${args.filePath}${stalenessWarn}`;
    } catch (error) {
        if (tmp) {
            try {
                await fs.unlink(tmp);
            } catch {
                // 清理失败忽略
            }
        }
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};
