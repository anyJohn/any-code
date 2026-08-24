import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { globFunc } from "../src/tools/functions/glob";
import type { ToolContext } from "../src/context";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-glob-"));
fs.writeFileSync(path.join(tmp, "a.ts"), "x");
fs.writeFileSync(path.join(tmp, "b.md"), "x");
fs.mkdirSync(path.join(tmp, "sub"));
fs.writeFileSync(path.join(tmp, "sub", "c.ts"), "x");
// node_modules 应被 rg 默认尊重 .gitignore 跳过；此处无 .gitignore，但验证 basic
fs.mkdirSync(path.join(tmp, "node_modules"));
fs.writeFileSync(path.join(tmp, "node_modules", "dep.js"), "x");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const P = (): ToolContext => ({
    workspace: { rootPath: tmp } as never,
    eventStream: { submit: () => {} },
    signal: new AbortController().signal,
});

// SPEC-021 AC-002：glob 用 rg --files -g PATTERN
describe("globFunc（SPEC-021 AC-002，ripgrep）", () => {
    it("pattern *.ts 返顶层 .ts", async () => {
        const out = await globFunc({ pattern: "*.ts" }, P());
        expect(out).toContain("a.ts");
        expect(out).not.toContain("b.md");
    });
    it("pattern **/*.ts 递归返 sub/c.ts", async () => {
        const out = await globFunc({ pattern: "**/*.ts" }, P());
        expect(out).toContain("a.ts");
        expect(out).toContain("c.ts");
    });
    it("无匹配返提示", async () => {
        const out = await globFunc({ pattern: "*.nope" }, P());
        expect(out).toMatch(/No files/);
    });
});
