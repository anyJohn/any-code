import { spawn } from "node:child_process";
import type { ToolContext } from "../../context";

interface ExecuteBashArgs {
    command: string;
}

/** 长/挂起命令的超时（与原 exec 一致）。spawn 无 maxBuffer——输出边流式上抛边累积，无 1MB 限制。 */
const BASH_TIMEOUT_MS = 120_000;

/**
 * 执行 bash 命令。用 spawn（shell 模式，支持管道/重定向/&&），stdout/stderr 逐 chunk
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

        // shell:true 让命令经 shell 解释（与原 exec 行为一致）
        // signal: 父 abort（stop）→ spawn 自动杀子进程
        let child;
        try {
            child = spawn(args.command, {
                cwd: workspace.rootPath,
                shell: true,
                signal: ctx.signal,
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
