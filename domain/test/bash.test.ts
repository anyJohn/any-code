import { describe, it, expect, vi } from "vitest";
import { executeBashFunc } from "../src/tools/functions/bash";
import type { ToolContext } from "../src/context";

const mkCtx = (emitProgress?: (c: string) => void): ToolContext => ({
    workspace: { rootPath: process.cwd() } as never,
    eventStream: { submit: vi.fn() },
    signal: new AbortController().signal,
    emitProgress,
});

// SPEC-018 AC-001：bash spawn 流式 stdout/stderr 经 emitProgress 上抛
describe("executeBashFunc 流式（SPEC-018 AC-001）", () => {
    it("逐行 stdout 经 emitProgress 上抛 + result 含全部输出", async () => {
        const chunks: string[] = [];
        const ctx = mkCtx((c) => chunks.push(c));
        const out = await executeBashFunc({ command: "echo a; echo b" }, ctx);
        const joined = chunks.join("");
        expect(joined).toContain("a");
        expect(joined).toContain("b");
        expect(out).toContain("a");
        expect(out).toContain("b");
    });

    it("无 emitProgress 也正常返回 result", async () => {
        const ctx = mkCtx();
        const out = await executeBashFunc({ command: "echo hi" }, ctx);
        expect(out.trim()).toBe("hi");
    });

    it("stderr 也流式上抛 + result 含 stderr", async () => {
        const chunks: string[] = [];
        const ctx = mkCtx((c) => chunks.push(c));
        const out = await executeBashFunc({ command: "echo err 1>&2" }, ctx);
        expect(chunks.join("")).toContain("err");
        expect(out).toContain("err");
    });

    it("非零退出码不抛，返回输出或 exit code", async () => {
        const ctx = mkCtx();
        const out = await executeBashFunc({ command: "exit 3" }, ctx);
        expect(out).toMatch(/exit code 3|Error/);
    });
});
