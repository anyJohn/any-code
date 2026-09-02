import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ToolContext } from "../../context";
import type { ToolResult } from "../index";
import { globalConfigDir } from "../../workspace";

interface ExecuteBashArgs {
    command: string;
    /** 超时毫秒（模型可指定）。clamp 到 [1000, 600000]，默认 120000。AR-2 */
    timeout_ms?: number;
    /** 后台执行（FR-13）：立即返回 job id，输出经 job_output 工具查询、job_kill 终止 */
    run_in_background?: boolean;
}

/** 默认超时；模型可用 timeout_ms 覆盖（硬上限 600s）。AR-2 */
const BASH_DEFAULT_TIMEOUT_MS = 120_000;
const BASH_MAX_TIMEOUT_MS = 600_000;

/** 输出双限（AR-2）：行数 / 字节，超限保留头部 + 截断标记 + spill 文件路径。 */
const OUTPUT_MAX_LINES = 2000;
const OUTPUT_MAX_BYTES = 40_000;

/**
 * 超限输出落盘（pi/Claude Code 同构）：全量写临时文件，截断标记给出路径，
 * 模型可用 read 工具分段读取。写失败忽略（截断标记仍有效）。
 */
function spillOutput(out: string): string | null {
    try {
        const file = join(tmpdir(), `anycode-bash-${randomBytes(6).toString("hex")}.log`);
        writeFileSync(file, out, "utf-8");
        return file;
    } catch {
        return null;
    }
}

/** 截断结果：text 给模型，truncated/spillFile 进结构化 meta（FR-10）。 */
interface CappedOutput {
    text: string;
    truncated: boolean;
    spillFile?: string;
}

/** 双限截断：保留头部，附截断标记（总行数/字节 + spill 路径）。未超限原样返回。 */
function capBashOutput(out: string): CappedOutput {
    const lines = out.split("\n");
    const truncated =
        lines.length > OUTPUT_MAX_LINES || Buffer.byteLength(out, "utf-8") > OUTPUT_MAX_BYTES;
    if (!truncated) return { text: out, truncated: false };

    let kept = out;
    if (Buffer.byteLength(kept, "utf-8") > OUTPUT_MAX_BYTES) {
        // 按字节截（避免把多字节字符劈半：从上限往回找）
        let end = OUTPUT_MAX_BYTES;
        while (end > 0 && (out.charCodeAt(end) & 0xc0) === 0x80) end--;
        kept = out.slice(0, end);
        kept = kept.split("\n").slice(0, OUTPUT_MAX_LINES).join("\n");
    } else {
        kept = lines.slice(0, OUTPUT_MAX_LINES).join("\n");
    }
    const spill: string | null = spillOutput(out);
    const spillFile = spill ?? undefined;
    const spillNote = spillFile
        ? `\n[完整输出已写入文件：${spillFile}（可用 read 工具分段查看）]`
        : "";
    const text =
        `${kept}\n[输出截断：共 ${lines.length} 行 / ${Buffer.byteLength(out, "utf-8")} 字节，` +
        `仅保留前 ${kept.split("\n").length} 行]${spillNote}`;
    return { text, truncated: true, spillFile };
}

/** 解析超时：clamp 到 [1s, 600s]，非法/缺省用默认值。 */
function resolveTimeoutMs(timeoutMs?: number): number {
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
        return BASH_DEFAULT_TIMEOUT_MS;
    }
    return Math.min(Math.max(Math.round(timeoutMs), 1000), BASH_MAX_TIMEOUT_MS);
}

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
): Promise<ToolResult> => {
    const { workspace } = ctx;
    return new Promise<ToolResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        // timer 声明前置（后台分支在 timer 赋值前 finish，避免 TDZ）
        let timer: NodeJS.Timeout | undefined;

        const finish = (value: ToolResult) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(value);
        };

        // FR-13 后台执行：注册 job 立即返回（不占 120s 超时、不阻塞 loop）
        if (args.run_in_background) {
            if (!ctx.jobs) {
                finish({ content: "Error: 后台任务不可用（当前环境未启用任务注册表）" });
                return;
            }
            try {
                const { binary, cwd } = resolveShell(workspace.rootPath, ctx.gitBashPath);
                const id = ctx.jobs.launch(binary, ["-c", args.command], cwd);
                finish({
                    content:
                        `后台任务已启动：job_id=${id}\n` +
                        `用 job_output 工具查看输出（参数 id="${id}"），完成后用 job_kill 终止（如需）。`,
                    data: { jobId: id, background: true },
                });
            } catch (err) {
                finish({ content: `Error: ${(err as Error).message}` });
            }
            return;
        }

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
            finish({ content: `Error: ${(err as Error).message}`, data: { exitCode: null } });
            return;
        }

        timer = setTimeout(() => {
            child.kill("SIGTERM");
        }, resolveTimeoutMs(args.timeout_ms));

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
            finish({ content: `Error: ${err.message}`, data: { exitCode: null } });
        });
        child.on("close", (code, signal) => {
            const raw = `${stdout}${stderr}`.trim();
            const timedOut = signal === "SIGTERM";
            const cap = capBashOutput(raw);
            const content = timedOut
                ? `[Timed out after ${resolveTimeoutMs(args.timeout_ms)}ms]\n${cap.text}`
                : code !== 0
                  ? // 非零退出码（grep 无匹配、ls 目标不存在等）也走这里，输出对 agent 有用，不丢弃
                    cap.text || `Error: exit code ${code}`
                  : cap.text;
            // FR-10 结构化 meta：退出码/截断/spill 供 UI 与系统消费（模型只见 content）
            finish({
                content,
                data: {
                    exitCode: code,
                    timedOut,
                    truncated: cap.truncated,
                    ...(cap.spillFile ? { spillFile: cap.spillFile } : {}),
                },
            });
        });
    });
};
