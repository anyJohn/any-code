import { existsSync, readFileSync } from "node:fs";
import { existsSync as _e } from "node:fs";
import { isAbsolute, join } from "node:path";
import { globalConfigDir } from "./workspace";

/**
 * Shell 解析（AR-19 抽离：prompt.ts（L2）与 tools/functions/bash.ts（L3）共用，
 * 避免基础设施层反向依赖运行时工具层）。
 */

/** Windows 上系统 Git for Windows 的 bash.exe 回退路径。 */
export const SYSTEM_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

/**
 * Windows Git Bash 探测候选：扫描 PATH 环境变量（bash.exe / sh.exe / git.exe 派生）。
 * Git 安装器默认把 Git\cmd 加入 PATH，覆盖绝大多数安装位；不在 PATH 的用设置页
 * 文件选择对话框手动指定（config.gitBashPath）。纯同步无 spawn。
 */
export function windowsGitBashCandidates(): string[] {
    const out: string[] = [];
    for (const raw of (process.env.PATH ?? "").split(";")) {
        const base = raw.trim().replace(/[/\\]+$/, "");
        if (!base || !isAbsolute(base)) continue;
        out.push(join(base, "bash.exe"));
        out.push(join(base, "sh.exe"));
        out.push(join(base, "bin", "bash.exe"));
        out.push(join(base, "usr", "bin", "bash.exe"));
        // Git\cmd\git.exe 布局 → Git\bin、Git\usr\bin
        out.push(join(base, "..", "bin", "bash.exe"));
        out.push(join(base, "..", "usr", "bin", "bash.exe"));
    }
    return out;
}

/**
 * Windows bash 候选序（bugfix 2026-09-08：busybox 工具链残缺）。优先完整 GNU 工具链：
 * config 显式指定 → 系统 Git Bash 探测 → busybox 兜底 → POSIX。
 */
export function bashCandidates(gitBashPath?: string): string[] {
    const busyboxLike = (p?: string) => !!p && p.toLowerCase().includes("busybox");
    const configBash = !busyboxLike(gitBashPath) ? gitBashPath : undefined;
    const detected = process.platform === "win32" ? windowsGitBashCandidates() : [];
    return [
        configBash,
        ...detected,
        SYSTEM_GIT_BASH,
        process.env.ANYCODE_BASH_PATH,
        join(globalConfigDir(), "runtime", "busybox", "sh.exe"),
        // POSIX 兜底（非 Windows 平台总可用；Windows 上这两个路径不存在自然过滤）
        "/bin/bash",
        "/bin/sh",
    ].filter((x): x is string => !!x && existsSync(x));
}

/** 当前生效 shell 的种类——用于注入 system prompt 提示 LLM 命令兼容性。 */
export type ShellKind =
    | "sh"
    | "mac-sh"
    | "git-bash"
    | "busybox"
    | "unknown"
    | "none";

/**
 * 解析 shell 种类（供 prompt 注入；不抛错——Windows 无 bash 时返回 none，prompt 静默跳过）。
 * - macOS：/bin/sh（bash 3.2 POSIX 模式 + BSD 工具集）→ mac-sh
 * - 其它 unix：/bin/sh → sh
 * - Windows：binary 路径含 busybox → busybox；含 git/bash → git-bash；否则 unknown
 */
export function resolveShellKind(gitBashPath?: string): ShellKind {
    if (process.platform !== "win32") {
        return process.platform === "darwin" ? "mac-sh" : "sh";
    }
    const binary = bashCandidates(gitBashPath)[0];
    if (!binary) return "none";
    const lower = binary.toLowerCase();
    if (lower.includes("busybox")) return "busybox";
    // MinGit 只带 usr/bin/sh.exe（实为 bash POSIX 模式 + 完整 GNU 工具链），也算 git-bash
    if (lower.includes("git") || lower.includes("bash") || lower.includes("portablegit")) return "git-bash";
    return "unknown";
}
