import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ToolContext } from "../../context";
import { globalConfigDir } from "../../workspace";

interface ExecuteBashArgs {
    command: string;
}

/** 长/挂起命令的超时（与原 exec 一致）。spawn 无 maxBuffer——输出边流式上抛边累积，无 1MB 限制。 */
const BASH_TIMEOUT_MS = 120_000;

/** Windows 上系统 Git for Windows 的 bash.exe 回退路径。 */
const SYSTEM_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

/**
 * Windows 盘符路径 → MSYS 风格（C:\Users\foo → /c/Users/foo），posix 路径不动。
 * bash.exe 的 cwd 用 MSYS 路径，避免 Windows 反斜杠/盘符在 bash 里被误解析。
 */
export function toMsysCwd(p: string): string {
    if (process.platform !== "win32") return p;
    return p
        .replace(/^([A-Za-z]):[\\/]/, (_m, d: string) => `/${d.toLowerCase()}/`)
        .replace(/\\/g, "/");
}

/**
 * 解析执行 shell：unix 用 /bin/sh；Windows 按候选序找 bash.exe（保持 bash 全平台统一，
 * prompt/skills 不分叉）。候选 = config.gitBashPath（首选）→ 安装器下发的 PortableGit 位置
 * → 系统 Git for Windows。都没有则抛错（在 config.yaml 配 gitBashPath 或装 Git for Windows）。
 */
export function resolveShell(
    cwd: string,
    gitBashPath?: string
): { binary: string; cwd: string } {
    if (process.platform !== "win32") return { binary: "/bin/sh", cwd };
    const candidates = [
        gitBashPath,
        join(globalConfigDir(), "runtime", "portablegit", "bin", "bash.exe"),
        SYSTEM_GIT_BASH,
    ].filter((x): x is string => !!x && existsSync(x));
    const binary = candidates[0];
    if (!binary) {
        throw new Error(
            "Windows 未找到 Git Bash（在 ~/.anycode/config.yaml 配 gitBashPath，或安装 Git for Windows）"
        );
    }
    return { binary, cwd: toMsysCwd(cwd) };
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
