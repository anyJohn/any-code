import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashCandidates, windowsGitBashCandidates } from "../src/shell";

describe("windowsGitBashCandidates（PATH 扫描 + 静态安装位）", () => {
    it("PATH 目录下的 bash.exe / git.exe 派生路径被探测到", () => {
        const dir = mkdtempSync(join(tmpdir(), "pw-bash-"));
        const bash = join(dir, "bash.exe");
        writeFileSync(bash, "");
        const oldPath = process.env.PATH;
        try {
            process.env.PATH = dir;
            const hits = windowsGitBashCandidates().filter((p) =>
                p.toLowerCase().includes(dir.toLowerCase())
            );
            expect(hits).toContain(bash);
        } finally {
            if (oldPath === undefined) delete process.env.PATH;
            else process.env.PATH = oldPath;
        }
    });

    it("Git\\cmd 布局：git.exe 同目录派生 ..\\bin、..\\usr\\bin\\bash.exe", () => {
        const root = mkdtempSync(join(tmpdir(), "pw-git-"));
        const cmd = join(root, "cmd");
        mkdirSync(cmd);
        mkdirSync(join(root, "usr", "bin"), { recursive: true });
        writeFileSync(join(cmd, "git.exe"), "");
        const bash = join(root, "usr", "bin", "bash.exe");
        writeFileSync(bash, "");
        const oldPath = process.env.PATH;
        try {
            process.env.PATH = cmd;
            const hits = windowsGitBashCandidates();
            expect(hits).toContain(bash);
        } finally {
            if (oldPath === undefined) delete process.env.PATH;
            else process.env.PATH = oldPath;
        }
    });
});

describe("bashCandidates（候选序）", () => {
    it("config.gitBashPath 存在且非 busybox 时优先", () => {
        const dir = mkdtempSync(join(tmpdir(), "pw-cand-"));
        const mine = join(dir, "my-bash.exe");
        writeFileSync(mine, "");
        const cands = bashCandidates(mine);
        expect(cands[0]).toBe(mine);
        // POSIX 兜底仍在队尾
        expect(cands[cands.length - 1]).toBe("/bin/sh");
    });

    it("config 指向 busybox 时被跳过，回落探测", () => {
        const dir = mkdtempSync(join(tmpdir(), "pw-bb-"));
        const bb = join(dir, "busybox-sh.exe");
        writeFileSync(bb, "");
        const cands = bashCandidates(bb);
        // busybox 路径不出现在结果里（除非经 ANYCODE_BASH_PATH 兜底——本机未注入）
        expect(cands[0]).not.toBe(bb);
        expect(cands.length).toBeGreaterThan(0);
    });
});
