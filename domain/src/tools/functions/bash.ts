import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ToolContext } from "../../context";
import { globalConfigDir } from "../../workspace";

interface ExecuteBashArgs {
    command: string;
}

/** 长/挂起命令的超时。spawn 无 maxBuffer——输出边流式上抛边累积，无 1MB 限制。 */
const BASH_TIMEOUT_MS = 120_000;

/** Windows 上系统 Git for Windows 的 bash.exe 回退路径。 */
const SYSTEM_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

/**
 * Windows bash 候选序：ANYCODE_BASH_PATH（桌面/launcher 注入，同 ANYCODE_RG_PATH 模式）
 * → config.gitBashPath（install.ps1 写入）→ 安装器下发的 busybox-w32 → 系统 Git for Windows。
 * 存在性过滤后取首个。
 */
function bashCandidates(gitBashPath?: string): string[] {
    return [
        process.env.ANYCODE_BASH_PATH,
        gitBashPath,
        join(globalConfigDir(), "runtime", "busybox", "sh.exe"),
        SYSTEM_GIT_BASH,
    ].filter((x): x is string => !!x && existsSync(x));
}

/**
 * 解析执行 shell：unix 用 /bin/sh；Windows 按候选序找 bash.exe（保持 bash 全平台统一，
 * prompt/skills 不分叉）。都没有则抛错（在 config.yaml 配 gitBashPath 或装 Git for Windows）。
 * cwd 保持原生 OS 路径（win 上 Windows 路径，bash.exe 内部自行转 MSYS 展示）。
 */
export function resolveShell(
    cwd: string,
    gitBashPath?: string
): { binary: string; cwd: string } {
    if (process.platform !== "win32") return { binary: "/bin/sh", cwd };
    const binary = bashCandidates(gitBashPath)[0];
    if (!binary) {
        throw new Error(
            "Windows 未找到 Git Bash（设 ANYCODE_BASH_PATH，或在 ~/.anycode/config.yaml 配 gitBashPath，或安装 Git for Windows）"
        );
    }
    return { binary, cwd };
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

/**
 * 执行 bash 命令。显式 spawn(binary, ["-c", command])：规避 Node 的 shell:<bash.exe>
 * 在 Windows 会传 /d /s /c（cmd 语法）bash 不认的问题（DEC-089）。stdout/stderr 逐 chunk
 * 经 ctx.emitProgress 流式上抛（TOOL_PROGRESS 事件），结束时返回完整 result（stdout+stderr）。
 * 超时 SIGTERM 杀进程；ctx.signal abort（stop）同样杀子进程。
 */
export const executeBashFunc = async (
    args: ExecuteBashArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    return new Promise<string>((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (value: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };

        let child: ReturnType<typeof spawn>;
        try {
            const { binary, cwd } = resolveShell(
                workspace.rootPath,
                ctx.gitBashPath
            );
            child = spawn(binary, ["-c", args.command], {
                cwd,
                signal: ctx.signal,
                windowsHide: true,
            });
        } catch (err) {
            finish(`Error: ${(err as Error).message}`);
            return;
        }

        const timer = setTimeout(() => {
            child.kill("SIGTERM");
        }, BASH_TIMEOUT_MS);

        const onChunk = (chunk: Buffer, stream: "stdout" | "stderr") => {
            const text = chunk.toString();
            if (stream === "stdout") stdout += text;
            else stderr += text;
            // 流式上抛每个 chunk（TOOL_PROGRESS），前端实时见输出
            ctx.emitProgress?.(text);
        };
        child.stdout?.on("data", (c: Buffer) => onChunk(c, "stdout"));
        child.stderr?.on("data", (c: Buffer) => onChunk(c, "stderr"));

        child.on("error", (err) => {
            finish(`Error: ${err.message}`);
        });
        child.on("close", (code, signal) => {
            const out = `${stdout}${stderr}`.trim();
            if (signal === "SIGTERM") {
                finish(`[Timed out after ${BASH_TIMEOUT_MS}ms]\n${out}`);
            } else if (code !== 0) {
                // 非零退出码（grep 无匹配、ls 目标不存在等）也走这里，输出对 agent 有用，不丢弃
                finish(out || `Error: exit code ${code}`);
            } else {
                finish(out);
            }
        });
    });
};
