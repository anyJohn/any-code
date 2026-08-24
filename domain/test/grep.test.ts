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
    it("无匹配返提示（code 1）", async () => {
        const out = await grepFunc({ pattern: "zzzznomatch" }, P());
        expect(out).toMatch(/No matches/);
    });
});
