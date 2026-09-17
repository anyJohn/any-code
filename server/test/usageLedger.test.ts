import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentEvent } from "@any-code/domain";
import { AgentManager } from "../src/agentManager.js";
import { runningSessions, runningWorkspaces } from "../src/singleFlight.js";

// SPEC-042 P3 验证：账本 resume/replay 不重复计数。
// 账本唯一写入点 = AgentManager.register 的 eventStream$ 内部订阅（live 事件）。
// eventStream$ 是普通 Subject（无重放语义）；重挂/刷新走 /history + /stream 重放
// （routes 层 send() 直发 SSE，不经过 register 订阅）；新 run 的 AnyAgent.create
// 全新 EventStream（不重灌历史）。故"同会话刷新两次"账本行数不变。
// 本测试用 mock 计数器锁死该不变式：history 预置 Usage + 多次 register → 0 写入。

const { appendUsageRecordMock } = vi.hoisted(() => ({
    appendUsageRecordMock: vi.fn<(pk: string, rec: unknown) => Promise<void>>(),
}));

vi.mock("@any-code/domain", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@any-code/domain")>();
    return {
        ...actual,
        appendUsageRecord: appendUsageRecordMock,
    };
});

function mkEvent(partial: Partial<AgentEvent> & { type: string }): AgentEvent {
    return { timestamp: Date.now(), message: partial.type, ...partial } as AgentEvent;
}

function usageEvent(tokens = 100): AgentEvent {
    return mkEvent({
        type: "Usage",
        message: "usage",
        data: {
            prompt_tokens: tokens,
            completion_tokens: tokens / 10,
            contextWindow: 128000,
            model: "m1",
        },
    });
}

function mkFakeAgent(history: AgentEvent[] = []) {
    let hist: AgentEvent[] = [...history];
    const subs = new Set<(e: AgentEvent) => void>();
    return {
        eventHistory$: {
            get value() {
                return hist;
            },
        },
        eventStream$: {
            subscribe(fn: (e: AgentEvent) => void) {
                subs.add(fn);
                return { unsubscribe: () => subs.delete(fn) };
            },
        },
        getProjectKey: () => "pk-test",
        getService: () => ({
            appendEvent: vi.fn().mockResolvedValue(undefined),
            appendUsage: vi.fn().mockResolvedValue(undefined),
        }),
        destroy: vi.fn(),
        stop: vi.fn(),
        emit(e: AgentEvent) {
            for (const s of subs) s(e); // live 先、history 后（与 EventStream.submit 同序）
            hist = [...hist, e];
        },
    };
}

function mkManager(max = 3) {
    return new AgentManager(() => max);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("usage ledger 不重复计数（P3）", () => {
    beforeEach(() => {
        appendUsageRecordMock.mockReset();
        appendUsageRecordMock.mockResolvedValue(undefined);
        runningSessions().clear();
        runningWorkspaces().clear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("live Usage 事件 → 账本恰好一行（含模型/扩展指标透传）", async () => {
        const m = mkManager();
        const agent = mkFakeAgent();
        m.register(agent as never, "s1", "/w");
        agent.emit(usageEvent(120));
        await flush();
        expect(appendUsageRecordMock).toHaveBeenCalledTimes(1);
        expect(appendUsageRecordMock).toHaveBeenCalledWith("pk-test", {
            ts: expect.any(Number),
            sessionId: "s1",
            model: "m1",
            prompt_tokens: 120,
            completion_tokens: 12,
        });
    });

    it("刷新重挂：register 时 history 中的旧 Usage 不重放（0 写入）", async () => {
        const m = mkManager();
        const agent = mkFakeAgent([usageEvent(50)]); // 上一 run 留下的 history
        m.register(agent as never, "s1", "/w");
        await flush();
        expect(appendUsageRecordMock).not.toHaveBeenCalled();
    });

    it("同会话刷新两次（两个 agent 各带同一份 history）→ 账本不增长", async () => {
        const m = mkManager();
        const h = [usageEvent(50)];
        m.register(mkFakeAgent(h) as never, "s1", "/w"); // 刷新 1
        m.register(mkFakeAgent(h) as never, "s1", "/w"); // 刷新 2（重新 register 场景）
        await flush();
        expect(appendUsageRecordMock).not.toHaveBeenCalled();
    });

    it("重挂后任务继续跑：只有新 live Usage 计账，旧 history 不重复", async () => {
        const m = mkManager();
        const agent = mkFakeAgent([usageEvent(50)]);
        m.register(agent as never, "s1", "/w");
        agent.emit(usageEvent(80)); // 本 run 新产生的一次调用
        await flush();
        expect(appendUsageRecordMock).toHaveBeenCalledTimes(1);
        expect(appendUsageRecordMock).toHaveBeenCalledWith(
            "pk-test",
            expect.objectContaining({ prompt_tokens: 80 })
        );
    });

    it("sub-agent Usage（author 非空）同样入账且带 author", async () => {
        const m = mkManager();
        const agent = mkFakeAgent();
        m.register(agent as never, "s1", "/w");
        const ev = usageEvent(30) as AgentEvent & { author?: string };
        ev.author = "plan";
        agent.emit(ev);
        await flush();
        expect(appendUsageRecordMock).toHaveBeenCalledWith(
            "pk-test",
            expect.objectContaining({ author: "plan", prompt_tokens: 30 })
        );
    });
});
