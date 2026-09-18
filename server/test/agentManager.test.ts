import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentEvent } from "@any-code/domain";
import { AgentManager } from "../src/agentManager.js";
import { runningSessions, runningWorkspaces } from "../src/singleFlight.js";

/**
 * AgentManager 单测（FR-30 / SPEC-033）：托管表 / 终态 finalize / ask 状态跟踪 /
 * 并发闸排队 / 显式 stop。AnyAgent 用最小 fake（不引 rxjs：manager 只消费
 * eventHistory$.value 与 eventStream$.subscribe），序号与扇出语义对齐
 * domain EventStream（live 先、history 后）。
 */

function mkEvent(partial: Partial<AgentEvent> & { type: string }): AgentEvent {
    return { timestamp: Date.now(), message: partial.type, ...partial } as AgentEvent;
}

function mkFakeAgent(events: AgentEvent[] = []) {
    let history: AgentEvent[] = [...events];
    const subs = new Set<(e: AgentEvent) => void>();
    return {
        eventHistory$: {
            get value() {
                return history;
            },
            next(events: AgentEvent[]) {
                history = events;
            },
        },
        eventStream$: {
            subscribe(fn: (e: AgentEvent) => void) {
                subs.add(fn);
                return { unsubscribe: () => subs.delete(fn) };
            },
        },
        getProjectKey: () => "pk-test",
        getService: () => ({ appendEvent: vi.fn().mockResolvedValue(undefined) }),
        destroy: vi.fn(),
        stop: vi.fn(),
        emit(e: AgentEvent) {
            for (const s of subs) s(e); // 与 EventStream.submit 同序：live 先、history 后
            history = [...history, e];
        },
    };
}

function mkManager(max = 3) {
    return new AgentManager(() => max);
}

describe("AgentManager（FR-30 / SPEC-033）", () => {
    beforeEach(() => {
        runningSessions().clear();
        runningWorkspaces().clear();
    });

    it("register 扇出带 per-run 序号；终态 → finalize（入热缓存 + 出表 + 清标记）", async () => {
        const m = mkManager();
        const agent = mkFakeAgent();
        const entry = m.register(agent as never, "s1", "/w");
        const frames: number[] = [];
        m.addSubscriber("s1", (f) => frames.push(f.seq));

        agent.emit(mkEvent({ type: "System", message: "boot" }));
        agent.emit(mkEvent({ type: "Done", message: "完成" }));
        // fanout 同步；appendEvent/destroy 的 await 链让出一拍
        await new Promise((r) => setTimeout(r, 0));
        expect(frames).toEqual([0, 1]); // per-run 单调序号
        expect(m.get("s1")).toBeUndefined(); // 终态出表
        expect(agent.destroy).not.toHaveBeenCalled(); // 入热缓存而非 destroy（SPEC-043）
        expect(runningSessions().has("s1")).toBe(false);
        expect(runningWorkspaces().has("pk-test")).toBe(false);
        expect(entry.subscribers.size).toBeGreaterThanOrEqual(0);
    });

    it.each(["Done", "Error", "Stopped"] as const)("热缓存：%s 后 takeWarm 清空运行事件并返回同一 agent；错配 → null 并 destroy", async (type) => {
        const m = mkManager();
        const agent = mkFakeAgent();
        m.register(agent as never, "s1", "/w");
        agent.emit(mkEvent({ type, message: "完成" }));
        await new Promise((r) => setTimeout(r, 0));

        // 命中：同会话同工作区
        expect(agent.eventHistory$.value.map((e) => e.type)).toEqual([type]);
        const warm = m.takeWarm("s1", "/w");
        expect(warm).toBe(agent);
        expect(agent.eventHistory$.value).toEqual([]); // 新 run 不重放上一轮终态
        // 取走后再取 → null
        expect(m.takeWarm("s1", "/w")).toBeNull();

        // 错配工作区 → null 且 destroy
        const agent2 = mkFakeAgent();
        m.register(agent2 as never, "s2", "/w2");
        agent2.emit(mkEvent({ type: "Done", message: "完成" }));
        await new Promise((r) => setTimeout(r, 0));
        expect(m.takeWarm("s2", "/other")).toBeNull();
        expect(agent2.destroy).toHaveBeenCalledOnce();
    });

    it("热缓存容量 8：第 9 个入缓存时逐出最旧并 destroy（AC-008）", async () => {
        const m = mkManager();
        const agents: ReturnType<typeof mkFakeAgent>[] = [];
        for (let i = 0; i < 9; i++) {
            const a = mkFakeAgent();
            agents.push(a);
            m.register(a as never, `s${i}`, "/w");
            a.emit(mkEvent({ type: "Done", message: "完成" }));
        }
        await new Promise((r) => setTimeout(r, 0));
        // 最旧（s0）被逐出销毁；s1..s8 仍在缓存
        expect(agents[0].destroy).toHaveBeenCalledOnce();
        expect(m.takeWarm("s0", "/w")).toBeNull();
        expect(m.takeWarm("s8", "/w")).toBe(agents[8]);
    });

    it("ask 挂起的 agent 不入缓存（C-003）：终态即 destroy", async () => {
        const m = mkManager();
        const agent = mkFakeAgent();
        m.register(agent as never, "s1", "/w");
        agent.emit(
            mkEvent({
                type: "PermissionAsk",
                message: "permission: bash",
                data: { id: "ask1", tool: "bash", summary: "rm -rf /" },
            }),
        );
        agent.emit(mkEvent({ type: "Stopped", message: "停止" }));
        await new Promise((r) => setTimeout(r, 0));
        expect(agent.destroy).toHaveBeenCalledOnce();
        expect(m.takeWarm("s1", "/w")).toBeNull();
    });

    it("statusList：PermissionAsk → waiting_ask + pendingAsk；Permission decided → running", async () => {
        const m = mkManager();
        const agent = mkFakeAgent();
        m.register(agent as never, "s1", "/w");
        agent.emit(
            mkEvent({
                type: "PermissionAsk",
                message: "permission: bash",
                data: { id: "ask1", tool: "bash", summary: "rm -rf /" },
            }),
        );
        expect(m.statusList()[0]).toMatchObject({
            sessionId: "s1",
            status: "waiting_ask",
            pendingAsk: { id: "ask1", tool: "bash" },
        });
        agent.emit(
            mkEvent({
                type: "Permission",
                message: "permission decided: bash",
                data: {
                    tool: "bash",
                    pattern: "cat *",
                    source: "mode",
                    action: "ask",
                    phase: "decided",
                    decision: "allow_once",
                },
            }),
        );
        await new Promise((r) => setTimeout(r, 0)); // durable 事件持久化 await 让出一拍
        expect(m.statusList()[0]).toMatchObject({ status: "running", pendingAsk: null });
    });

    it("stop：running → agent.stop()（stopping）；未知会话 → null", () => {
        const m = mkManager();
        expect(m.stop("nope")).toBeNull();
        const agent = mkFakeAgent();
        m.register(agent as never, "s1", "/w");
        expect(m.stop("s1")).toBe("stopping");
        expect(agent.stop).toHaveBeenCalledOnce();
    });

    it("并发闸：满载排队，release FIFO 唤醒；0 = 不限", async () => {
        const m = mkManager(2);
        const r1 = await m.acquire("s1", "pk");
        const r2 = await m.acquire("s2", "pk");
        expect(m.hasFreeSlot()).toBe(false);
        let third = false;
        const p3 = m.acquire("s3", "pk").then((r) => {
            third = true;
            return r;
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(third).toBe(false); // 排队中
        r1();
        await new Promise((r) => setTimeout(r, 0));
        expect(third).toBe(true); // FIFO 唤醒
        r2();
        (await p3)();
        expect(m.statusList()).toHaveLength(0);

        // 0 = 不限：acquire 立即返回且无排队
        const unlimited = mkManager(0);
        const ur = await unlimited.acquire("x", "pk");
        expect(unlimited.hasFreeSlot()).toBe(true);
        ur();
    });

    it("cancelQueued：排队中取消不再唤醒", async () => {
        const m = mkManager(1);
        const r1 = await m.acquire("s1", "pk");
        const p2 = m.acquire("s2", "pk");
        expect(m.cancelQueued("s2")).toBe(true);
        expect(m.cancelQueued("s2")).toBe(false);
        r1();
        let resolved = false;
        void p2.then(() => (resolved = true));
        await new Promise((r) => setTimeout(r, 0));
        expect(resolved).toBe(false);
    });

    it("stopAll：全部 destroy + 出表 + 排队唤醒", async () => {
        const m = mkManager();
        const a1 = mkFakeAgent();
        const a2 = mkFakeAgent();
        m.register(a1 as never, "s1", "/w1");
        m.register(a2 as never, "s2", "/w2");
        const queued = m.acquire("s3", "pk");
        m.stopAll();
        expect(a1.destroy).toHaveBeenCalledOnce();
        expect(a2.destroy).toHaveBeenCalledOnce();
        expect(m.statusList()).toHaveLength(0);
        await expect(queued).resolves.toBeDefined(); // 排队者被唤醒（进程即将退出）
    });
});
