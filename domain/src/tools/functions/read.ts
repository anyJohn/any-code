import fs from "fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import type { ToolContext } from "../../context";
import { resolvePathWithEscape } from "../../workspace";
import { decodeFileText } from "../../textDecode";

interface ReadArgs {
    filePath: string;
    /** 起始行号（1 起，缺省 1）。 */
    offset?: number;
    /** 读取行数（缺省 2000）。 */
    limit?: number;
}

/**
 * 图片类扩展名（todo#15）：二进制格式硬解成 UTF-8/GBK 全是替换符，模型看不懂。
 * 改为 base64 内联——模型可借此判断图片大致内容（尺寸/格式），如需视觉理解
 * 应提示用户把图片贴进对话（web 端 file chip 有真正的多模态通道）。
 */
const IMAGE_EXTS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".ico",
    ".svg",
    ".avif",
]);

export const readFunc = async (
    args: ReadArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    try {
        const { offset = 1, limit = 2000 } = args;
        // 工作区外路径：权限层 ask 兜底（toolCall 注入 __absFilePath），此处不再硬拒绝
        const filePath =
            (args as { __absFilePath?: string }).__absFilePath ??
            resolvePathWithEscape(workspace, args.filePath).abs;

        const buf = await fs.readFile(filePath);

        // 图片文件：base64 而非硬解文本（todo#15）
        if (IMAGE_EXTS.has(path.extname(filePath).toLowerCase())) {
            const mime =
                path.extname(filePath).toLowerCase() === ".svg"
                    ? "image/svg+xml"
                    : `image/${path
                          .extname(filePath)
                          .toLowerCase()
                          .slice(1)
                          .replace("jpg", "jpeg")}`;
            const b64 = buf.toString("base64");
            const head =
                `[Binary image file: ${path.basename(filePath)}, ${buf.length} bytes, ${mime}. ` +
                `Base64 follows — you cannot visually render it; ask the user to attach the image to the chat if visual inspection is needed.]\n\n`;
            return head + b64.slice(0, 2000) + (b64.length > 2000 ? "\n[... base64 truncated]" : "");
        }

        const content = decodeFileText(buf).text;

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
