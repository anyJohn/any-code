import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { exploreFunc } from "../src/tools/functions/explore";
import type { ToolContext } from "../src/context";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-explore-"));
fs.mkdirSync(path.join(tmp, "sub"));
fs.writeFileSync(path.join(tmp, "sub", "a.ts"), "x");
fs.mkdirSync(path.join(tmp, "empty"));

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const P = (): ToolContext => ({
    workspace: { rootPath: tmp, ignoredPatterns: ["node_modules", ".git"] } as never,
    eventStream: { submit: () => {} },
    signal: new AbortController().signal,
});

describe("exploreFunc", () => {
    it("正常目录 → 渲染树（含子目录文件名）", async () => {
        const out = await exploreFunc({ directoryPath: "sub" }, P());
        expect(out).toContain("Directory Structure");
        expect(out).toContain("a.ts");
    });

    it("空目录 → 有标题行但无子项（合法结果，不报错）", async () => {
        const out = await exploreFunc({ directoryPath: "empty" }, P());
        expect(out).toContain("Directory Structure");
        expect(out).not.toMatch(/Error/);
    });

    // bugfix 2026-09-20：原先目录不存在时返回空树，与"存在但为空"无法区分——
    // 假阴性会让人以为目录存在。现显式报错。
    it("目录不存在 → 明确报错（不再返回空树假装成功）", async () => {
        const out = await exploreFunc({ directoryPath: "no/such/dir" }, P());
        expect(out).toMatch(/目录不存在/);
        expect(out).toContain("no/such/dir");
    });

    it("路径是文件而非目录 → 提示用 read", async () => {
        const out = await exploreFunc({ directoryPath: "sub/a.ts" }, P());
        expect(out).toMatch(/不是目录/);
        expect(out).toMatch(/read/);
    });

    it("工作区外路径 → 路径逃逸拦截", async () => {
        const out = await exploreFunc({ directoryPath: "../../../etc" }, P());
        expect(out).toMatch(/路径逃逸/);
    });
});
