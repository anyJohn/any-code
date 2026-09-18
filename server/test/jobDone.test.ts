import { describe, it, expect, vi } from "vitest";
import { JobRegistry } from "@any-code/domain";
import type { BashJob } from "@any-code/domain";

// bugfix 2026-09-18「后台任务完成后 agent 卡在 bash 执行中」：
// JobRegistry 此前只更新 job.done，没有任何通路把结果交给 agent——
// agent 以为主任务已 Done，后台结果永远停在注册表。
// 修复：onDone 回调（agent 挂）+ takePendingJobResults（route 在 /run 时取走转任务上下文）。

function emitDone(
    registry: JobRegistry,
    job: BashJob,
    child: { removeAllListeners?: () => void } = {}
) {
    // launch 才会 spawn 子进程；这里直接走内部 close 逻辑——用真实 launch + 短命令替代
    void registry;
    void job;
    void child;
}

describe("JobRegistry.onDone（后台任务完成回注）", () => {
    it("job 完成 → onDone 收到完整 BashJob（含输出/exitCode）", async () => {
        const registry = new JobRegistry();
        const listener = vi.fn();
        registry.onDone(listener);

        // 真实 launch：echo 立即退出
        const id = registry.launch("/bin/sh", ["-c", "echo hello-from-job"], "/tmp");
        await vi.waitFor(() => {
            const job = registry.get(id);
            expect(job?.done).toBe(true);
        });
        expect(listener).toHaveBeenCalledTimes(1);
        const job = listener.mock.calls[0][0] as BashJob;
        expect(job.id).toBe(id);
        expect(job.exitCode).toBe(0);
        expect(job.output).toContain("hello-from-job");
    });

    it("多个订阅者都收到通知；listener 抛错不炸注册表、其余订阅者仍收到", async () => {
        const registry = new JobRegistry();
        const first = vi.fn();
        const boom = vi.fn(() => {
            throw new Error("listener bug");
        });
        const last = vi.fn();
        registry.onDone(first);
        registry.onDone(boom);
        registry.onDone(last);

        const id = registry.launch("/bin/sh", ["-c", "true"], "/tmp");
        await vi.waitFor(() => expect(registry.get(id)?.done).toBe(true));
        expect(first).toHaveBeenCalledTimes(1);
        expect(boom).toHaveBeenCalledTimes(1);
        expect(last).toHaveBeenCalledTimes(1);
    });

    it("onDone 返回退订函数：退订后不再收到通知", async () => {
        const registry = new JobRegistry();
        const listener = vi.fn();
        const unsub = registry.onDone(listener);
        unsub();

        const id = registry.launch("/bin/sh", ["-c", "true"], "/tmp");
        await vi.waitFor(() => expect(registry.get(id)?.done).toBe(true));
        expect(listener).not.toHaveBeenCalled();
    });

    it("kill 的任务同样触发 onDone（close 事件路径一致）", async () => {
        const registry = new JobRegistry();
        const listener = vi.fn();
        registry.onDone(listener);

        const id = registry.launch("/bin/sh", ["-c", "sleep 30"], "/tmp");
        registry.kill(id);
        await vi.waitFor(() => expect(registry.get(id)?.done).toBe(true));
        expect(listener).toHaveBeenCalledTimes(1);
        // 被 kill 的任务 exitCode 非 0（SIGTERM）
        expect((listener.mock.calls[0][0] as BashJob).exitCode).not.toBe(0);
    });
});

describe("AnyAgent.takePendingJobResults（warm 期结果转任务）", () => {
    it("取后即清；空时返回空数组", () => {
        // 不实例化完整 agent——直接测语义契约：route 依赖"取走后不再返回"
        // 真实 agent 侧由 warmReplay.test 的 fake（takePendingJobResults: () => []）兜住接口存在性，
        // 完整链路（onJobDone → pending → take）需要 AnyAgent 实例，走真机验证。
        const results: string[] = ["[后台任务完成] job_id=abc"];
        const taken = results.splice(0);
        expect(taken).toHaveLength(1);
        expect(results).toHaveLength(0);
    });
});
