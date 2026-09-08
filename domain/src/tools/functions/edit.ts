import fs from "fs/promises";
import type { ToolContext } from "../../context";
import type { ToolResult } from "../index";
import { resolvePath } from "../../workspace";
import { decodeFileText } from "../../textDecode";
import iconv from "iconv-lite";
import { stalenessWarning, recordMtime } from "./fileState";

interface EditFileArgs {
    filePath: string;
    oldString: string;
    newString: string;
}

/**
 * 精确字符串替换编辑。须唯一匹配：oldString 不存在或多次出现则报错、不落盘。
 * staleness：read/write 记过 mtime 且当前 mtime 漂移 → result 警告（不阻断编辑）。SPEC-022 B-005/B-006。
 */
export const editFunc = async (
    args: EditFileArgs,
    ctx: ToolContext
): Promise<ToolResult> => {
    const { workspace } = ctx;
    try {
        const { oldString, newString } = args;
        const filePath =
            (args as { __absFilePath?: string }).__absFilePath ??
            resolvePath(workspace, args.filePath);
        // 按文件实际编码解码（GBK 兜底），写回时保持原编码
        const { text: content, encoding } = decodeFileText(
            await fs.readFile(filePath)
        );

        // CRLF 归一化：Windows 项目文件普遍是 CRLF，模型给的 oldString 几乎总是 LF——
        // 不归一化则匹配必失败（Windows 上 edit 不可用的根因）。写回时还原 CRLF。
        const edit = applyEdit(content, oldString, newString);
        if (!edit.ok) {
            return { content: `Error: ${edit.error}` };
        }

        const stalenessWarn = stalenessWarning(
            ctx.fileState,
            filePath,
            "编辑"
        );

        await fs.writeFile(
            filePath,
            encoding === "gbk" ? iconv.encode(edit.content, "gbk") : Buffer.from(edit.content, "utf8"),
        );
        recordMtime(ctx.fileState, filePath);

        return {
            content: `Successfully edited file.\n--- Removed:\n${oldString}\n--- Added:\n${newString}${stalenessWarn}`,
            data: { filePath },
        };
    } catch (error) {
        if (error instanceof Error) {
            return { content: `Error: ${error.message}` };
        }
        return { content: `Error: ${String(error)}` };
    }
};

/**
 * 编辑核心（纯函数，可单测）：
 * - CRLF 文件先把内容与 old/new 归一化为 LF 再匹配替换，写回前还原 CRLF——
 *   Windows 项目文件普遍 CRLF，模型给的 oldString 几乎总是 LF（不归一化必失败）；
 * - 唯一性校验照旧：0 次或多次命中都报错。
 */
export function applyEdit(
    content: string,
    oldString: string,
    newString: string
): { ok: boolean; content: string; crlf: boolean; error?: string } {
    const crlf = content.includes("\r\n");
    const norm = (t: string) => (crlf ? t.replace(/\r\n/g, "\n") : t);
    const body = norm(content);
    const oldN = norm(oldString);
    const newN = norm(newString);

    if (!body.includes(oldN)) {
        return { ok: false, content, crlf, error: "oldString not found in file. Cannot perform replacement." };
    }
    const occurrences = (
        body.match(new RegExp(oldN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []
    ).length;
    if (occurrences > 1) {
        return {
            ok: false,
            content,
            crlf,
            error: "oldString appears " + occurrences + " times in the file. Please make the oldString more specific to match only once.",
        };
    }
    let result = body.replace(oldN, newN);
    if (crlf) result = result.replace(/\n/g, "\r\n");
    return { ok: true, content: result, crlf };
}
