import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { killTree, detachedIfPosix } from "./processKill";
import { createStreamDecoder } from "./textDecode";

/** 完成任务：面板保留窗口 / 内部可查询 LRU 上限（SPEC-038） */
export const DONE_RETENTION_MS = 60_000;
export const DONE_JOB_LIMIT = 50;

/**
 * bash 后台任务注册表（FR-13）：per-agent 生命周期（destroy 时 killAll）。
 * launch 立即返回 job id，输出后台累积；job_output 查询、job_kill 终止。
 * 输出环形上限 200KB（超限丢弃头部并标记 truncated）。
 */

export interface BashJob {
    id: string;
    command: string;
    /** bash intent 字段（FR-28 批 1）：模型附的一句意图，面板标题优先显示 */
    intent?: string;
    /** 累积输出（≤200KB，超限丢头部） */
    output: string;
    truncated: boolean;
    done: boolean;
    exitCode: number | null;
    startedAt: number;
    /** 完成时刻（SPEC-038：面板保留 60s 后退场） */
    finishedAt?: number;
    /** 子进程 pid（spawn 即有；job_output 展示与测试定位用） */
    pid: number | undefined;
}

const OUTPUT_CAP = 200_000;

export class JobRegistry {
    private jobs = new Map<string, BashJob & { child: ChildProcess }>();

    /** 后台启动命令；返回 job id。 */
    launch(
        binary: string,
        args: string[],
        cwd: string,
        intent?: string
    ): string {
        const id = randomBytes(4).toString("hex");
        const child = spawn(binary, args, { cwd, windowsHide: true, ...detachedIfPosix });
        const job: BashJob & { child: ChildProcess } = {
            id,
            command: args[args.length - 1] ?? "",
            intent,
            output: "",
            truncated: false,
            done: false,
            exitCode: null,
            startedAt: Date.now(),
            pid: child.pid,
            child,
        };
        // GBK 兜底解码（Windows 中文系统控制台工具输出 cp936，UTF-8 硬解乱码）
        const decOut = createStreamDecoder();
        const decErr = createStreamDecoder();
        const onChunk = (c: Buffer, src: "out" | "err") => {
            job.output += src === "out" ? decOut.decode(c) : decErr.decode(c);
            if (job.output.length > OUTPUT_CAP) {
                job.output = "…[earlier output dropped]\n" + job.output.slice(-OUTPUT_CAP);
                job.truncated = true;
            }
        };
        child.stdout?.on("data", (c: Buffer) => onChunk(c, "out"));
        child.stderr?.on("data", (c: Buffer) => onChunk(c, "err"));
        child.on("close", (code) => {
            job.done = true;
            job.exitCode = code;
            job.finishedAt = Date.now();
            // 完成任务 LRU 上限：防长驻 server 内存无界（输出 ≤200KB/个）
            const done = [...this.jobs.values()].filter((x) => x.done);
            if (done.length > DONE_JOB_LIMIT) {
                done.sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
                for (const old of done.slice(0, done.length - DONE_JOB_LIMIT)) {
                    this.jobs.delete(old.id);
                }
            }
        });
        child.on("error", () => {
            job.done = true;
            job.exitCode = -1;
            job.output += "\n[job error: failed to spawn]";
        });
        this.jobs.set(id, job);
        return id;
    }

    get(id: string): BashJob | null {
        const j = this.jobs.get(id);
        if (!j) return null;
        const { child: _child, ...rest } = j;
        return rest;
    }

    /** 任务快照（新→旧）。已完成任务保留 60s 后从面板退场（内部仍可查询，LRU 上限 50）。 */
    list(): BashJob[] {
        const cutoff = Date.now() - DONE_RETENTION_MS;
        return [...this.jobs.values()]
            .reverse()
            .filter((j) => !j.done || (j.finishedAt ?? 0) > cutoff)
            .map(({ child: _c, ...rest }) => rest);
    }

    /** 终止任务（SIGTERM）。返回是否找到。 */
    kill(id: string): boolean {
        const j = this.jobs.get(id);
        if (!j || j.done) return j ? true : false;
        killTree(j.child);
        return true;
    }

    /** agent 销毁时终止全部后台任务（不留孤儿进程）。 */
    killAll(): void {
        for (const j of this.jobs.values()) {
            if (!j.done) killTree(j.child);
        }
    }
}
