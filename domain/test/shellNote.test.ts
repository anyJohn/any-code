import { describe, it, expect } from "vitest";
import { shellNote } from "../src/prompt";
import { resolveShellKind } from "../src/tools/functions/bash";

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
            expect(resolveShellKind("/tmp", undefined)).toBe("mac-sh");
        } else {
            expect(resolveShellKind("/tmp", undefined)).toBe("sh");
        }
    });
});
