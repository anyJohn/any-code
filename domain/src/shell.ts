import { existsSync, readFileSync } from "node:fs";
import { existsSync as _e } from "node:fs";
import { join } from "node:path";
import { globalConfigDir } from "./workspace";

/**
 * Shell 解析（AR-19 抽离：prompt.ts（L2）与 tools/functions/bash.ts（L3）共用，
 * 避免基础设施层反向依赖运行时工具层）。
 */

/** Windows 上系统 Git for Windows 的 bash.exe 回退路径。 */
export const SYSTEM_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

/**
 * Windows bash 候选序：ANYCODE_BASH_PATH（桌面/launcher 注入，同 ANYCODE_RG_PATH 模式）
 * → config.gitBashPath（install.ps1 写入）→ 安装器下发的 busybox-w32 → 系统 Git for Windows。
 * 存在性过滤后取首个。
 */
export function bashCandidates(gitBashPath?: string): string[] {
    return [
        process.env.ANYCODE_BASH_PATH,
        gitBashPath,
        join(globalConfigDir(), "runtime", "busybox", "sh.exe"),
        SYSTEM_GIT_BASH,
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
    if (lower.includes("git") || lower.includes("bash")) return "git-bash";
    return "unknown";
}
