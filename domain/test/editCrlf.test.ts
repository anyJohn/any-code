import { describe, expect, it } from "vitest";
import { applyEdit } from "../src/tools/functions/edit";

describe("applyEdit（CRLF 归一化 + 唯一性校验）", () => {
    it("CRLF 文件：LF oldString 命中成功，写回保持 CRLF", () => {
        const file = "line1\r\nline2\r\nline3\r\n";
        const r = applyEdit(file, "line2\n", "edited\n");
        expect(r.ok).toBe(true);
        expect(r.content).toBe("line1\r\nedited\r\nline3\r\n");
        expect(r.crlf).toBe(true);
    });

    it("LF 文件行为不变", () => {
        const r = applyEdit("a\nb\nc\n", "b", "B");
        expect(r.ok).toBe(true);
        expect(r.content).toBe("a\nB\nc\n");
        expect(r.crlf).toBe(false);
    });

    it("CRLF 混合 LF：以 CRLF 为主即按 CRLF 处理", () => {
        const r = applyEdit("x\r\ny\nz\r\n", "y\n", "Y\n");
        expect(r.ok).toBe(true);
        expect(r.content).toBe("x\r\nY\r\nz\r\n");
    });

    it("未命中报错", () => {
        expect(applyEdit("a\r\nb", "nope", "x").ok).toBe(false);
    });

    it("多次命中报错", () => {
        const r = applyEdit("dup\r\ndup\r\n", "dup\n", "x\n");
        expect(r.ok).toBe(false);
        expect(r.error).toContain("2 times");
    });
});
