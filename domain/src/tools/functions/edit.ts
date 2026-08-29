import fs from "fs/promises";
import { statSync } from "node:fs";
import type { ToolContext } from "../../context";
import { resolvePath } from "../../workspace";

interface EditFileArgs {
    filePath: string;
    oldString: string;
    newString: string;
}

const mtimeOf = (p: string): number | undefined => {
    try {
        return statSync(p).mtimeMs;
    } catch {
        return undefined;
    }
};

/**
 * 精确字符串替换编辑。须唯一匹配：oldString 不存在或多次出现则报错、不落盘。
 * staleness：read/write 记过 mtime 且当前 mtime 漂移 → result 警告（不阻断编辑）。SPEC-022 B-005/B-006。
 */
export const editFunc = async (
    args: EditFileArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    try {
        const { oldString, newString } = args;
        const filePath = resolvePath(workspace, args.filePath);
        const content = await fs.readFile(filePath, "utf-8");

        if (!content.includes(oldString)) {
            return `Error: oldString not found in file. Cannot perform replacement.`;
        }

        const occurrences = (
            content.match(
                new RegExp(
                    oldString.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                    "g"
                )
            ) || []
        ).length;

        if (occurrences > 1) {
            return `Error: oldString appears ${occurrences} times in the file. Please make the oldString more specific to match only once.`;
        }

        // staleness：read/write 记过 mtime 且当前漂移 → 警告（不阻断编辑）
        const fileState = ctx.fileState;
        let stalenessWarn = "";
        if (fileState) {
            const recorded = fileState.get(filePath);
            if (recorded !== undefined) {
                const cur = mtimeOf(filePath);
                if (cur !== undefined && Math.abs(cur - recorded) > 1) {
                    stalenessWarn =
                        " [警告: 文件自上次 read 后被外部改动，已编辑]";
                }
            }
        }

        const newContent = content.replace(oldString, newString);
        await fs.writeFile(filePath, newContent, "utf-8");

        // 记录新 mtime（供后续 write/edit staleness）
        if (fileState) {
            const nm = mtimeOf(filePath);
            if (nm !== undefined) fileState.set(filePath, nm);
        }

        return `Successfully edited file.\n--- Removed:\n${oldString}\n--- Added:\n${newString}${stalenessWarn}`;
    } catch (error) {
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};