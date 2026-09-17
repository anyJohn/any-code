import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFunc } from "../src/tools/functions/read.js";
import type { ToolContext } from "../src/context";

// todo#15：图片文件 read → base64 + 元数据提示，而非硬解文本（模型看不懂二进制）。
// PNG 魔数头 8 字节固定，硬解必产生 U+FFFD——修复前 read 图片返回乱码。

function mkCtx(ws: string): ToolContext {
    return { workspace: { rootPath: ws } } as unknown as ToolContext;
}

describe("read 工具图片处理（todo#15）", () => {
    const dir = mkdtempSync(join(tmpdir(), "anycode-read-"));
    const pngBytes = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG 魔数
        Buffer.alloc(64, 0xab), // 任意二进制体
    ]);
    const pngPath = join(dir, "img.png");
    writeFileSync(pngPath, pngBytes);

    const ws = join(dir, "ws");
    mkdirSync(ws, { recursive: true });
    const relPath = "../img.png"; // 相对 rootPath 的路径（resolvePathWithEscape 处理 ..）

    it("图片 → base64 + 提示头（含字节数/mime），不含 U+FFFD 乱码", async () => {
        const out = await readFunc({ filePath: relPath }, mkCtx(ws));
        expect(out).toContain("[Binary image file: img.png");
        expect(out).toContain(`${pngBytes.length} bytes`);
        expect(out).toContain("image/png");
        expect(out).toContain("ask the user to attach");
        // base64 字符集（PNG 魔数 89504e470d0a1a0a 对应前缀 "iVBORw0KGg"）
        expect(out).toContain("iVBORw0KGg");
        expect(out).not.toContain("\uFFFD");
    });

    it("超大图片 base64 截断（防 token 爆炸）", async () => {
        const big = join(dir, "big.png");
        writeFileSync(big, Buffer.alloc(64 * 1024, 0x07));
        const out = await readFunc({ filePath: "../big.png" }, mkCtx(ws));
        expect(out).toContain("[... base64 truncated]");
        expect(out.length).toBeLessThan(4000);
    });

    it("文本文件路径不受影响（回归）", async () => {
        const txt = join(ws, "a.txt");
        writeFileSync(txt, "hello\nworld\n");
        const out = await readFunc({ filePath: "a.txt" }, mkCtx(ws));
        expect(out).toContain("1\thello");
        expect(out).toContain("2\tworld");
    });

    afterAll(() => {
        rmSync(dir, { recursive: true, force: true });
    });
});
