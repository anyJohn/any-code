import { describe, it, expect } from "vitest";
import { shellNote, cleanSessionTitle } from "../src/prompt";
import { resolveShellKind } from "../src/shell";

describe("shellNote（只报环境，不指导）", () => {
    it("busybox：只报环境名 + POSIX subset", () => {
        const n = shellNote("busybox");
        expect(n).toContain("busybox");
        expect(n).toContain("POSIX");
        // 精简后不含命令指导
        expect(n).not.toContain("mapfile");
        expect(n).not.toContain("/c/Users");
    });
    it("git-bash：只报环境名", () => {
        const n = shellNote("git-bash");
        expect(n).toContain("Git Bash");
        expect(n).not.toContain("/c/Users");
    });
    it("mac-sh：报 macOS /bin/sh + bash 3.2 + BSD userland", () => {
        const n = shellNote("mac-sh");
        expect(n).toContain("macOS /bin/sh");
        expect(n).toContain("bash 3.2");
        expect(n).toContain("BSD userland");
    });
    it("sh / none / unknown：静默", () => {
        expect(shellNote("sh")).toBe("");
        expect(shellNote("none")).toBe("");
        expect(shellNote("unknown")).toBe("");
    });
});

describe("resolveShellKind（平台判定）", () => {
    it("非 Windows：macOS → mac-sh；其它 unix → sh", () => {
        if (process.platform === "win32") return;
        if (process.platform === "darwin") {
            expect(resolveShellKind(undefined)).toBe("mac-sh");
        } else {
            expect(resolveShellKind(undefined)).toBe("sh");
        }
    });
});

describe("cleanSessionTitle（LLM 标题清洗）", () => {
    it("去首尾引号/书名号/句号 + 截断 40", () => {
        expect(cleanSessionTitle('"你好"')).toBe("你好");
        expect(cleanSessionTitle("「项目分析」")).toBe("项目分析");
        expect(cleanSessionTitle("《读代码》")).toBe("读代码");
        expect(cleanSessionTitle("重构模块。")).toBe("重构模块");
        expect(cleanSessionTitle('  "空格清理"  ')).toBe("空格清理");
    });
    it("无引号则原样（截断）", () => {
        expect(cleanSessionTitle("查股票数据")).toBe("查股票数据");
    });
    it("空串/纯符号 → 空串（调用方回退）", () => {
        expect(cleanSessionTitle('"""')).toBe("");
        expect(cleanSessionTitle("   ")).toBe("");
    });
});
