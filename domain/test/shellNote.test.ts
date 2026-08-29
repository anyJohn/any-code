import { describe, it, expect } from "vitest";
import { shellNote } from "../src/prompt";
import { resolveShellKind } from "../src/tools/functions/bash";

describe("shellNote（命令兼容性提示注入）", () => {
    it("busybox：明示 POSIX 子集 + 禁用 bashism", () => {
        const n = shellNote("busybox");
        expect(n).toContain("busybox");
        expect(n).toContain("POSIX");
        expect(n).toContain("mapfile");
        expect(n).toContain("/c/Users/");
    });
    it("git-bash：明示 Git Bash + 路径风格", () => {
        const n = shellNote("git-bash");
        expect(n).toContain("Git Bash");
        expect(n).toContain("/c/Users/");
    });
    it("sh / none / unknown：静默（unix 默认无需提示）", () => {
        expect(shellNote("sh")).toBe("");
        expect(shellNote("none")).toBe("");
        expect(shellNote("unknown")).toBe("");
    });
});

describe("resolveShellKind（平台判定）", () => {
    it("非 Windows → sh", () => {
        // 测试机为 linux；mac 同走 /bin/sh 分支
        if (process.platform === "win32") return;
        expect(resolveShellKind("/tmp", undefined)).toBe("sh");
    });
});
