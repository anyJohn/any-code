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
    if (!jobs) return { content: "Error: 后台任务不可用（当前环境未启用任务注册表）" };

    if (args.id) {
        const job = jobs.get(args.id.trim());
        if (!job) {
            const all = jobs.list().map((j) => j.id).join(", ");
            return {
                content: `Error: job ${args.id} 不存在。${all ? `现有任务：${all}` : "当前无后台任务。"}`,
            };
        }
        const status = job.done
            ? `已完成（exit code ${job.exitCode}）`
            : "运行中";
        return {
            content: `[${job.id}] ${status}\n命令：${job.command}\n输出：\n${job.output || "（暂无输出）"}`,
            data: { jobId: job.id, done: job.done, exitCode: job.exitCode, truncated: job.truncated },
        };
    }

    const all = jobs.list();
    if (all.length === 0) return { content: "当前无后台任务。" };
    const lines = all.map(
        (j) =>
            `[${j.id}] ${j.done ? `已完成（exit ${j.exitCode}）` : "运行中"} · ${j.command.slice(0, 60)}`
    );
    return { content: lines.join("\n"), data: { count: all.length } };
};

/** 终止后台任务（FR-13）。非只读（杀进程），权限走 ask/deny 通道。 */
export const jobKillFunc = async (
    args: { id?: string },
    ctx: ToolContext
): Promise<ToolResult> => {
    const jobs = ctx.jobs;
    if (!jobs) return { content: "Error: 后台任务不可用" };
    const id = args.id?.trim();
    if (!id) return { content: "Error: 需要 id 参数" };
    const ok = jobs.kill(id);
    if (!ok) return { content: `Error: job ${id} 不存在` };
    return { content: `后台任务 ${id} 已终止（SIGTERM）`, data: { jobId: id, killed: true } };
};
