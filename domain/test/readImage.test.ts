import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFunc } from "../src/tools/functions/read.js";
import type { ToolContext } from "../src/context";

// SPEC-043 B-002：图片文件 read → ToolResult.images（data URL 前置物料），
// 文本部分带元数据提示。toolCall 层负责转合成 user 消息的 image_url 块
// （视觉模型）或文本占位（非视觉模型，I-001）——本文件只测 handler 形态。
// 历史行为（todo#15）：硬解 UTF-8/GBK 产生 U+FFFD 乱码——回归红线。

function mkCtx(ws: string): ToolContext {
    return { workspace: { rootPath: ws } } as unknown as ToolContext;
}

describe("read 工具图片处理（SPEC-043 B-002）", () => {
    const dir = mkdtempSync(join(tmpdir(), "anycode-read-"));
    const pngBytes = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG 魔数
        Buffer.alloc(64, 0xab), // 任意二进制体
    ]);
    writeFileSync(join(dir, "img.png"), pngBytes);
    const bigPng = Buffer.alloc(3 * 1024 * 1024, 0x07);
    writeFileSync(join(dir, "big.png"), bigPng);

    const ws = join(dir, "ws");
    mkdirSync(ws, { recursive: true });

    it("图片 → images 数组（mime+base64）+ 元数据文本，不含 U+FFFD 乱码", async () => {
        const out = await readFunc({ filePath: "../img.png" }, mkCtx(ws));
        expect(out.content).toContain("[Image file: img.png");
        expect(out.content).toContain(`${pngBytes.length} bytes`);
        expect(out.content).toContain("image/png");
        expect(out.images).toHaveLength(1);
        // PNG 魔数 89504e470d0a1a0a 的 base64 前缀
        expect(out.images![0].base64.startsWith("iVBORw0KGg")).toBe(true);
        expect(out.images![0].mimeType).toBe("image/png");
        expect(out.content).not.toContain("\uFFFD");
    });

    it("jpg → image/jpeg mime 映射", async () => {
        writeFileSync(join(dir, "photo.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
        const out = await readFunc({ filePath: "../photo.jpg" }, mkCtx(ws));
        expect(out.images![0].mimeType).toBe("image/jpeg");
    });

    it("文本文件路径不受影响（回归：无 images 字段）", async () => {
        const txt = join(ws, "a.txt");
        writeFileSync(txt, "hello\nworld\n");
        const out = await readFunc({ filePath: "a.txt" }, mkCtx(ws));
        expect(out.images).toBeUndefined();
        expect(out.content).toContain("1\thello");
        expect(out.content).toContain("2\tworld");
    });

    afterAll(() => {
        rmSync(dir, { recursive: true, force: true });
    });
});
