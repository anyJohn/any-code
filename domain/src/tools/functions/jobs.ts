import type { ToolContext } from "../../context";
import type { ToolResult } from "../index";

/**
 * 后台任务查询（FR-13）：带 id 读单个任务输出/状态，不带 id 列出全部。
 * 只读、并发安全（权限默认放行，可与读类工具并行）。
 */
export const jobOutputFunc = async (
    args: { id?: string },
    ctx: ToolContext
): Promise<ToolResult> => {
    const jobs = ctx.jobs;
    if (!jobs)
        return {
            content:
                "Error: background jobs are unavailable (job registry not enabled in this environment)",
        };

    if (args.id) {
        const job = jobs.get(args.id.trim());
        if (!job) {
            const all = jobs.list().map((j) => j.id).join(", ");
            return {
                content: `Error: job ${args.id} not found.${all ? ` Existing jobs: ${all}` : " No background jobs."}`,
            };
        }
        const status = job.done
            ? `done (exit code ${job.exitCode})`
            : "running";
        return {
            content: `[${job.id}] ${status}\ncommand: ${job.command}\noutput:\n${job.output || "(no output yet)"}`,
            data: { jobId: job.id, done: job.done, exitCode: job.exitCode, truncated: job.truncated },
        };
    }

    const all = jobs.list();
    if (all.length === 0) return { content: "No background jobs." };
    const lines = all.map(
        (j) =>
            `[${j.id}] ${j.done ? `done (exit ${j.exitCode})` : "running"} · ${j.command.slice(0, 60)}`
    );
    return { content: lines.join("\n"), data: { count: all.length } };
};

/** 终止后台任务（FR-13）。非只读（杀进程），权限走 ask/deny 通道。 */
export const jobKillFunc = async (
    args: { id?: string },
    ctx: ToolContext
): Promise<ToolResult> => {
    const jobs = ctx.jobs;
    if (!jobs) return { content: "Error: background jobs are unavailable" };
    const id = args.id?.trim();
    if (!id) return { content: "Error: id parameter is required" };
    const ok = jobs.kill(id);
    if (!ok) return { content: `Error: job ${id} not found` };
    return { content: `Background job ${id} terminated (SIGTERM)`, data: { jobId: id, killed: true } };
};
