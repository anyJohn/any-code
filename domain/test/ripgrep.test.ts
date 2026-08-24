import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { runRipgrep } from "../src/ripgrep";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-rg-"));
fs.writeFileSync(path.join(tmp, "a.ts"), "hello\nworld\n");
fs.writeFileSync(path.join(tmp, "b.md"), "foo\n");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// SPEC-021 AC-001：runRipgrep spawn @vscode/ripgrep 二进制，强制 --no-config，纯 argv
describe("runRipgrep（SPEC-021 AC-001）", () => {
    it("--version 返 ripgrep 版本", async () => {
        const { stdout, code } = await runRipgrep(["--version"], { cwd: tmp });
        expect(code).toBe(0);
        expect(stdout).toMatch(/ripgrep/);
    });
    it("--files 列文件", async () => {
        const { stdout } = await runRipgrep(["--files"], { cwd: tmp });
        const lines = stdout.split("\n").filter(Boolean);
        expect(lines).toContain("a.ts");
        expect(lines).toContain("b.md");
    });
    it("无匹配退出码 1（不抛）", async () => {
        const { code } = await runRipgrep(
            ["--files", "--glob", "*.nomatch"],
            { cwd: tmp }
        );
        expect(code).toBe(1);
    });
});
