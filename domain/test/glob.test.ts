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

// bugfix 2026-09-20：原先只看 stdout 忽略退出码——rg 因目录不存在以 code=2 退出时
// stdout 为空，被误报成「No files found」（假阴性，让人以为目录存在但为空）。
describe("globFunc 路径不存在（假阴性回归）", () => {
    it("目录不存在 → 明确报路径问题，而非 No files found", async () => {
        const out = await globFunc({ pattern: "*.ts", path: "no/such/dir" }, P());
        expect(out).toMatch(/Search path does not exist/);
        expect(out).not.toMatch(/No files found/); // 旧的假阴性文案不得再出现
        expect(out).toContain("no/such/dir");
    });

    it("目录存在但确实无匹配 → 仍返回 No files found（不能矫枉过正）", async () => {
        const out = await globFunc({ pattern: "*.zzz", path: "sub" }, P());
        expect(out).toMatch(/No files found/);
    });

    it("正常路径不受影响（回归）", async () => {
        const out = await globFunc({ pattern: "*.ts" }, P());
        expect(out).toContain("a.ts");
    });
});
