import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { WorkspaceRegistry } from "@any-code/domain";
import { GET } from "@/app/api/workspaces/[projectKey]/files/route";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-files-"));
fs.writeFileSync(path.join(tmp, "alpha.ts"), "x");
fs.writeFileSync(path.join(tmp, "alphabet.ts"), "x");
fs.writeFileSync(path.join(tmp, "beta.ts"), "x");
const pk = WorkspaceRegistry.add(tmp).projectKey;

const req = (q?: string) =>
    new Request(
        q ? `http://x/files?q=${encodeURIComponent(q)}` : "http://x/files"
    );
const ctx = () => ({ params: Promise.resolve({ projectKey: pk }) });

afterAll(() => {
    WorkspaceRegistry.remove(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("/files route 缓存 + 过滤", () => {
    it("q 过滤返回匹配文件（首次 collect 填缓存）", async () => {
        const r = await GET(req("alpha"), ctx());
        const body = (await r.json()) as { name: string }[];
        const names = body.map((f) => f.name);
        expect(names).toContain("alpha.ts");
        expect(names).toContain("alphabet.ts");
        expect(names).not.toContain("beta.ts");
    });

    it("不同 q 复用缓存仍返回正确结果（不重新 collect 全树）", async () => {
        const r = await GET(req("beta"), ctx());
        const body = (await r.json()) as { name: string }[];
        const names = body.map((f) => f.name);
        expect(names).toContain("beta.ts");
        expect(names).not.toContain("alpha.ts");
        expect(names).not.toContain("alphabet.ts");
    });

    it("空 q 返回前 20 个文件", async () => {
        const r = await GET(req(), ctx());
        const body = (await r.json()) as { name: string }[];
        expect(body.length).toBeGreaterThan(0);
        expect(body.length).toBeLessThanOrEqual(20);
    });
});
