import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getFileIndex, preloadFileIndex } from "@/lib/fileIndex";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-fidx-"));
fs.writeFileSync(path.join(tmp, "alpha.ts"), "x");
fs.writeFileSync(path.join(tmp, "beta.ts"), "x");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("fileIndex（SPEC-020）", () => {
    it("AC-001 getFileIndex collect 正确 + 缓存命中返回同引用", () => {
        const pk = `fidx-1-${Date.now()}`;
        const f1 = getFileIndex(pk, tmp);
        const names = f1.map((f) => f.name);
        expect(names).toContain("alpha.ts");
        expect(names).toContain("beta.ts");
        // 二次调命中缓存（不重新 collect）→ 返回同引用
        expect(getFileIndex(pk, tmp)).toBe(f1);
    });

    it("AC-002 preload fire-and-forget 不阻塞 + 后台填缓存", async () => {
        const pk = `fidx-2-${Date.now()}`;
        // preload 同步返回（不阻塞）；后台 setImmediate collect
        expect(preloadFileIndex(pk, tmp)).toBeUndefined();
        await new Promise((r) => setTimeout(r, 30));
        // 后台填好后 getFileIndex 命中缓存（同引用）
        const f = getFileIndex(pk, tmp);
        expect(f.length).toBeGreaterThan(0);
        expect(getFileIndex(pk, tmp)).toBe(f);
    });

    it("preload fresh 时 no-op（不重新 collect）", async () => {
        const pk = `fidx-3-${Date.now()}`;
        getFileIndex(pk, tmp); // 先填缓存
        const before = getFileIndex(pk, tmp);
        preloadFileIndex(pk, tmp); // fresh → skip
        await new Promise((r) => setTimeout(r, 30));
        expect(getFileIndex(pk, tmp)).toBe(before); // 仍是同一缓存
    });
});
