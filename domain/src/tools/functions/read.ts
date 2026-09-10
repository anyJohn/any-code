import fs from "fs/promises";
import { statSync } from "node:fs";
import type { ToolContext } from "../../context";
import { resolvePath } from "../../workspace";
import { decodeFileText } from "../../textDecode";

interface ReadArgs {
    filePath: string;
    /** 起始行号（1 起，缺省 1）。 */
    offset?: number;
    /** 读取行数（缺省 2000）。 */
    limit?: number;
}

export const readFunc = async (
    args: ReadArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    try {
        const { offset = 1, limit = 2000 } = args;
        const filePath = resolvePath(workspace, args.filePath);
        const content = decodeFileText(await fs.readFile(filePath)).text;

        // 记录 mtime 供 write/edit staleness 校验（SPEC-022 B-006）。整文件读才记，
        // 偏移读（offset>1）不记基线（partial 读后整写本就该警告）。
        if (ctx.fileState && offset <= 1) {
            try {
                ctx.fileState.set(filePath, statSync(filePath).mtimeMs);
            } catch {
                // stat 失败忽略
            }
        }

        const lines = content.split("\n");
        const totalLines = lines.length;
        // offset 为行号（1 起）；行号单位是工具生态惯例（sed/编辑器），字符 offset
        // 极易切断行且让行号前缀失义（外部审查反馈 2026-09-10）
        const start = Math.max(1, offset);
        const end = Math.min(start - 1 + limit, totalLines);
        const selected = lines.slice(start - 1, end);
        const numbered = selected
            .map((line, i) => `${start + i}\t${line}`)
            .join("\n");

        if (end < totalLines) {
            return `${numbered}\n\n[... Truncated - ${
                totalLines - end
            } more lines. Use offset=${end + 1} to continue reading.]`;
        }
        if (start > 1) {
            return `[... Lines ${start}-${end} of ${totalLines} total lines]\n\n${numbered}`;
        }
        return numbered;
    } catch (error) {
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};
