import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { grepFunc } from "../src/tools/functions/grep";
import type { ToolContext } from "../src/context";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-grep-"));
fs.writeFileSync(path.join(tmp, "a.ts"), "hello world\nsecond HELLO\n");
fs.writeFileSync(path.join(tmp, "b.md"), "foo\nhello\n");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const P = (): ToolContext => ({
    workspace: { rootPath: tmp } as never,
    eventStream: { submit: () => {} },
    signal: new AbortController().signal,
});

// SPEC-021 AC-003：grep 用 rg，三 output_mode + case_insensitive
describe("grepFunc（SPEC-021 AC-003，ripgrep）", () => {
    it("content 模式返 file:line:content", async () => {
        const out = await grepFunc({ pattern: "hello" }, P());
        expect(out).toContain("a.ts");
        expect(out).toMatch(/1: hello world/);
        expect(out).toContain("b.md");
    });
    it("files_with_matches 返文件名", async () => {
        const out = await grepFunc(
            { pattern: "hello", output_mode: "files_with_matches" },
            P()
        );
        expect(out).toContain("a.ts");
        expect(out).toContain("b.md");
    });
    it("count 模式返 file: N matches", async () => {
        const out = await grepFunc(
            { pattern: "hello", output_mode: "count" },
            P()
        );
        expect(out).toMatch(/a\.ts: \d+ matches/);
    });
    it("case_insensitive 匹配大写", async () => {
        const out = await grepFunc(
            { pattern: "hello", case_insensitive: true },
            P()
        );
        expect(out).toMatch(/HELLO/); // 命中 second HELLO 行
    });
    it("path 为文件时仍能命中（假阴性回归，外部审查 2026-09-10）", async () => {
        const out = await grepFunc(
            { pattern: "hello", path: path.join(tmp, "a.ts") },
            P()
        );
        expect(out).toContain("a.ts");
        expect(out).toMatch(/1: hello world/);
    });
    it("无匹配返提示（code 1）", async () => {
        const out = await grepFunc({ pattern: "zzzznomatch" }, P());
        expect(out).toMatch(/No matches/);
    });
});

// bugfix 2026-09-20：spawn 失败时错误对象曾被丢弃，只能报误导性的「ripgrep 启动失败」
describe("grepFunc 错误诊断（spawn 失败不再丢原因）", () => {
    it("搜索路径不存在 → 明确报路径问题（而非「ripgrep 启动失败」）", async () => {
        const out = await grepFunc(
            { pattern: "hello", path: "no/such/dir" },
            P()
        );
        expect(out).toMatch(/搜索路径不存在/);
        expect(out).not.toMatch(/ripgrep 启动失败/); // 旧的误导文案不得再出现
        expect(out).toContain("no/such/dir");
    });

    it("工作区根不存在 → 同样给出路径诊断而非启动失败", async () => {
        const ctx = {
            workspace: { rootPath: "/nonexistent-root-xyz" } as never,
            eventStream: { submit: () => {} },
            signal: new AbortController().signal,
        } as ToolContext;
        const out = await grepFunc({ pattern: "hello" }, ctx);
        expect(out).toMatch(/搜索路径不存在/);
        expect(out).toContain("/nonexistent-root-xyz");
    });

    it("正常路径不受影响（回归：仍能命中）", async () => {
        const out = await grepFunc({ pattern: "hello" }, P());
        expect(out).toContain("a.ts");
    });
});
