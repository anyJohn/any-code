import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock node:fs 的 existsSync：resolveShell 用它探测 bash.exe 是否存在。
// 仅 win32 路径调用；linux 的 executeBashFunc 测试不触 fs（resolveShell 非 win32 早返）。
vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
import { existsSync } from "node:fs";

import { executeBashFunc, toMsysCwd, resolveShell } from "../src/tools/functions/bash";
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

// SPEC-024 AC-004：显式 spawn(binary,["-c",cmd]) + 平台 shell 解析 + MSYS cwd 翻译
describe("toMsysCwd（SPEC-024 AC-004）", () => {
    it("win32 盘符路径 → MSYS（C:\\Users\\foo → /c/Users/foo）", () => {
        setPlatform("win32");
        expect(toMsysCwd("C:\\Users\\foo")).toBe("/c/Users/foo");
        expect(toMsysCwd("D:\\proj\\a b")).toBe("/d/proj/a b");
    });
    it("win32 下已是 posix 风格不动", () => {
        setPlatform("win32");
        expect(toMsysCwd("/c/Users/foo")).toBe("/c/Users/foo");
        expect(toMsysCwd("/tmp/x")).toBe("/tmp/x");
    });
    it("非 win32 原样返回", () => {
        setPlatform("linux");
        expect(toMsysCwd("/home/john/项目")).toBe("/home/john/项目");
        expect(toMsysCwd("C:\\Users\\foo")).toBe("C:\\Users\\foo");
    });
});

describe("resolveShell（SPEC-024 AC-004）", () => {
    const PG_PATH = join(globalConfigDir(), "runtime", "portablegit", "bin", "bash.exe");

    it("unix → /bin/sh，cwd 不动", () => {
        setPlatform("linux");
        expect(resolveShell("/home/john/项目/any-code")).toEqual({
            binary: "/bin/sh",
            cwd: "/home/john/项目/any-code",
        });
    });

    it("win32：config gitBashPath 首选，cwd 翻 MSYS", () => {
        setPlatform("win32");
        vi.mocked(existsSync).mockImplementation(
            (p) => p === "C:\\custom\\bash.exe"
        );
        expect(resolveShell("C:\\Users\\john\\proj", "C:\\custom\\bash.exe")).toEqual({
            binary: "C:\\custom\\bash.exe",
            cwd: "/c/Users/john/proj",
        });
    });

    it("win32：无 config 但 PortableGit 在安装器下发位置 → 用它", () => {
        setPlatform("win32");
        vi.mocked(existsSync).mockImplementation((p) => p === PG_PATH);
        expect(resolveShell("D:\\work").binary).toBe(PG_PATH);
    });

    it("win32：无 config 无 PortableGit → 回退系统 Git", () => {
        setPlatform("win32");
        vi.mocked(existsSync).mockImplementation(
            (p) => p === "C:\\Program Files\\Git\\bin\\bash.exe"
        );
        expect(resolveShell("D:\\work")).toEqual({
            binary: "C:\\Program Files\\Git\\bin\\bash.exe",
            cwd: "/d/work",
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
