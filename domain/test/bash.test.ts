import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock node:fs 的 existsSync：resolveShell 用它探测 bash.exe 是否存在。
// 仅 win32 路径调用；其余 fs API 保留真实实现（AR-2 spill 落盘与测试读取需要）。
vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return { ...actual, existsSync: vi.fn() };
});
import { existsSync } from "node:fs";

import { executeBashFunc, resolveShell } from "../src/tools/functions/bash";
import { readFileSync, rmSync } from "node:fs";
import { globalConfigDir } from "../src/workspace";
import { join } from "node:path";
import type { ToolContext } from "../src/context";

// process.platform 是普通属性，可临时覆盖
const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const setPlatform = (p: string) =>
    Object.defineProperty(process, "platform", { value: p, configurable: true });

beforeEach(() => {
    vi.mocked(existsSync).mockReset();
});

afterEach(() => {
    if (origPlatform)
        Object.defineProperty(process, "platform", origPlatform);
});

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

// SPEC-024 AC-004：显式 spawn(binary,["-c",cmd]) + 平台 shell 解析
describe("resolveShell（SPEC-024 AC-004）", () => {
    const PG_PATH = join(globalConfigDir(), "runtime", "busybox", "sh.exe");

    it("unix → /bin/sh，cwd 不动", () => {
        setPlatform("linux");
        expect(resolveShell("/home/john/项目/any-code")).toEqual({
            binary: "/bin/sh",
            cwd: "/home/john/项目/any-code",
        });
    });

    it("win32：config gitBashPath 首选，cwd 保持原生 Windows（spawn cwd 须原生，CreateProcessW 要求）", () => {
        setPlatform("win32");
        vi.mocked(existsSync).mockImplementation(
            (p) => p === "C:\\custom\\bash.exe"
        );
        expect(resolveShell("C:\\Users\\john\\proj", "C:\\custom\\bash.exe")).toEqual({
            binary: "C:\\custom\\bash.exe",
            cwd: "C:\\Users\\john\\proj",
        });
    });

    it("win32：无 config 但 busybox 在安装器下发位置 → 用它", () => {
        setPlatform("win32");
        vi.mocked(existsSync).mockImplementation((p) => p === PG_PATH);
        expect(resolveShell("D:\\work").binary).toBe(PG_PATH);
    });

    it("win32：无 config 无 busybox → 回退系统 Git", () => {
        setPlatform("win32");
        vi.mocked(existsSync).mockImplementation(
            (p) => p === "C:\\Program Files\\Git\\bin\\bash.exe"
        );
        expect(resolveShell("D:\\work")).toEqual({
            binary: "C:\\Program Files\\Git\\bin\\bash.exe",
            cwd: "D:\\work",
        });
    });

    it("win32：都没有 → 抛错", () => {
        setPlatform("win32");
        vi.mocked(existsSync).mockReturnValue(false);
        expect(() => resolveShell("C:\\Users\\x")).toThrow(
            /Windows 未找到 Git Bash/
        );
    });
});


// ── 输出治理与超时参数（AR-2）──

describe("executeBashFunc 输出治理（AR-2）", () => {
    it("超限输出：截断标记（总行数）+ spill 文件路径，spill 含全量", async () => {
        const ctx = mkCtx();
        const out = await executeBashFunc({ command: "seq 1 5000" }, ctx);
        expect(out).toContain("[输出截断：共 5000 行");
        const m = out.match(/完整输出已写入文件：([^\s（]+)/);
        expect(m).toBeTruthy();
        const full = readFileSync(m![1], "utf-8");
        expect(full.split("\n").length).toBeGreaterThanOrEqual(5000);
        // 头部保留
        expect(out.split("\n")[0]).toBe("1");
        rmSync(m![1]);
    });

    it("未超限输出原样返回（无截断标记）", async () => {
        const ctx = mkCtx();
        const out = await executeBashFunc({ command: "echo hi" }, ctx);
        expect(out.trim()).toBe("hi");
        expect(out).not.toContain("[输出截断");
    });

    it("timeout_ms 参数生效：1500ms 超时杀掉 sleep 5（clamp 下限 1s）", async () => {
        const ctx = mkCtx();
        const t0 = Date.now();
        const out = await executeBashFunc(
            { command: "sleep 5", timeout_ms: 1500 },
            ctx
        );
        expect(Date.now() - t0).toBeLessThan(3000);
        expect(out).toContain("[Timed out after 1500ms]");
    }, 10_000);
});
