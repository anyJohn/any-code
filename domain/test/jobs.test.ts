import { describe, it, expect, vi, afterEach } from "vitest";
import { JobRegistry } from "../src/jobs";
import { executeBashFunc } from "../src/tools/functions/bash";
import { jobOutputFunc, jobKillFunc } from "../src/tools/functions/jobs";
import type { ToolContext } from "../src/context";

const mkCtx = (jobs: JobRegistry): ToolContext =>
    ({
        workspace: { rootPath: process.cwd() } as never,
        eventStream: { submit: vi.fn() },
        signal: new AbortController().signal,
        jobs,
    }) as ToolContext;

const registry = new JobRegistry();

afterEach(() => registry.killAll());

describe("JobRegistry（FR-13）", () => {
    it("launch 立即返回 id，输出累积，done/exitCode 回填", async () => {
        const id = registry.launch("/bin/sh", ["-c", "echo out1; echo out2"], process.cwd());
        const job = registry.get(id);
        expect(job).toBeTruthy();
        expect(job!.done).toBe(false);
        // 等任务结束
        await vi.waitFor(() => expect(registry.get(id)!.done).toBe(true));
        expect(registry.get(id)!.output).toContain("out1");
        expect(registry.get(id)!.output).toContain("out2");
        expect(registry.get(id)!.exitCode).toBe(0);
    });

    it("kill 终止运行中任务", async () => {
        const id = registry.launch("/bin/sh", ["-c", "sleep 30"], process.cwd());
        await new Promise((r) => setTimeout(r, 100));
        expect(registry.kill(id)).toBe(true);
        await vi.waitFor(() => expect(registry.get(id)!.done).toBe(true));
    });

    it("list 返回全部任务", () => {
        const id1 = registry.launch("/bin/sh", ["-c", "true"], process.cwd());
        registry.launch("/bin/sh", ["-c", "true"], process.cwd());
        expect(registry.list().length).toBeGreaterThanOrEqual(2);
        expect(registry.get(id1)).toBeTruthy();
    });
});

describe("bash run_in_background（FR-13）", () => {
    afterEach(() => registry.killAll());

    it("后台启动：立即返回 job_id 提示，不阻塞", async () => {
        const ctx = mkCtx(registry);
        const t0 = Date.now();
        const out = await executeBashFunc(
            { command: "sleep 5", run_in_background: true },
            ctx
        );
        expect(Date.now() - t0).toBeLessThan(1000);
        expect(out.content).toContain("job_id=");
        expect(out.data?.background).toBe(true);
    });

    it("jobs 未启用 → 明确报错", async () => {
        const ctx = mkCtx(new JobRegistry());
        const out = await executeBashFunc(
            { command: "true", run_in_background: true },
            { ...ctx, jobs: undefined } as ToolContext
        );
        expect(out.content).toContain("后台任务不可用");
    });
});

describe("job 工具（FR-13）", () => {
    afterEach(() => registry.killAll());

    it("job_output：带 id 读输出，不带 id 列表", async () => {
        const ctx = mkCtx(registry);
        const id = registry.launch("/bin/sh", ["-c", "echo bg-output"], process.cwd());
        await vi.waitFor(() => expect(registry.get(id)!.done).toBe(true));
        const one = await jobOutputFunc({ id }, ctx);
        expect(one.content).toContain("bg-output");
        expect(one.content).toContain("已完成");
        const list = await jobOutputFunc({}, ctx);
        expect(list.content).toContain(`[${id}]`);
    });

    it("job_output：未知 id → 报错并列出现有", async () => {
        const ctx = mkCtx(registry);
        registry.launch("/bin/sh", ["-c", "true"], process.cwd());
        const out = await jobOutputFunc({ id: "nope" }, ctx);
        expect(out.content).toContain("不存在");
    });

    it("job_kill：终止运行中任务", async () => {
        const ctx = mkCtx(registry);
        const id = registry.launch("/bin/sh", ["-c", "sleep 30"], process.cwd());
        const out = await jobKillFunc({ id }, ctx);
        expect(out.content).toContain("已终止");
        await vi.waitFor(() => expect(registry.get(id)!.done).toBe(true));
    });
});
