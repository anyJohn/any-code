import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * bash 后台任务注册表（FR-13）：per-agent 生命周期（destroy 时 killAll）。
 * launch 立即返回 job id，输出后台累积；job_output 查询、job_kill 终止。
 * 输出环形上限 200KB（超限丢弃头部并标记 truncated）。
 */

export interface BashJob {
    id: string;
    command: string;
    /** 累积输出（≤200KB，超限丢头部） */
    output: string;
    truncated: boolean;
    done: boolean;
    exitCode: number | null;
    startedAt: number;
}

const OUTPUT_CAP = 200_000;

export class JobRegistry {
    private jobs = new Map<string, BashJob & { child: ChildProcess }>();

    /** 后台启动命令；返回 job id。 */
    launch(binary: string, args: string[], cwd: string): string {
        const id = randomBytes(4).toString("hex");
        const child = spawn(binary, args, { cwd, windowsHide: true });
        const job: BashJob & { child: ChildProcess } = {
            id,
            command: args[args.length - 1] ?? "",
            output: "",
            truncated: false,
            done: false,
            exitCode: null,
            startedAt: Date.now(),
            child,
        };
        const onChunk = (c: Buffer) => {
            job.output += c.toString();
            if (job.output.length > OUTPUT_CAP) {
                job.output = "…[earlier output dropped]\n" + job.output.slice(-OUTPUT_CAP);
                job.truncated = true;
            }
        };
        child.stdout?.on("data", onChunk);
        child.stderr?.on("data", onChunk);
        child.on("close", (code) => {
            job.done = true;
            job.exitCode = code;
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

    /** 全部任务快照（新→旧）。 */
    list(): BashJob[] {
        return [...this.jobs.values()]
            .reverse()
            .map(({ child: _c, ...rest }) => rest);
    }

    /** 终止任务（SIGTERM）。返回是否找到。 */
    kill(id: string): boolean {
        const j = this.jobs.get(id);
        if (!j || j.done) return j ? true : false;
        j.child.kill("SIGTERM");
        return true;
    }

    /** agent 销毁时终止全部后台任务（不留孤儿进程）。 */
    killAll(): void {
        for (const j of this.jobs.values()) {
            if (!j.done) j.child.kill("SIGTERM");
        }
    }
}
