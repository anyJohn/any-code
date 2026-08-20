import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { GET as browse } from "@/app/api/fs/browse/route";

function reqWith(dir?: string) {
    const url = dir
        ? `http://x/api/fs/browse?dir=${encodeURIComponent(dir)}`
        : "http://x/api/fs/browse";
    return new Request(url);
}

describe("fs/browse (TEST-002 TC-002.5, B-008)", () => {
    it("返回非隐藏子目录，过滤隐藏目录，不含文件", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-fs-"));
        fs.mkdirSync(path.join(tmp, "sub-a"));
        fs.mkdirSync(path.join(tmp, "sub-b"));
        fs.mkdirSync(path.join(tmp, ".hidden"));
        fs.writeFileSync(path.join(tmp, "file.txt"), "x");

        const r = await browse(reqWith(tmp));
        const body = await r.json();
        expect(body.current).toBe(tmp);
        const names = body.dirs.map((d: { name: string }) => d.name);
        expect(names).toContain("sub-a");
        expect(names).toContain("sub-b");
        expect(names).not.toContain(".hidden");
        expect(names).not.toContain("file.txt");
        expect(body.parent).toBe(path.dirname(tmp));
        fs.rmSync(tmp, { recursive: true });
    });

    it("文件路径 → 退到父目录", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-fs2-"));
        const file = path.join(tmp, "f.txt");
        fs.writeFileSync(file, "x");
        const r = await browse(reqWith(file));
        const body = await r.json();
        expect(body.current).toBe(tmp);
        fs.rmSync(tmp, { recursive: true });
    });

    it("不存在路径 → 退回 home", async () => {
        const r = await browse(reqWith("/no/such/path/xyz"));
        const body = await r.json();
        expect(body.current).toBe(os.homedir());
    });

    it("无 dir 参数 → home", async () => {
        const r = await browse(reqWith());
        const body = await r.json();
        expect(body.current).toBe(os.homedir());
    });
});
