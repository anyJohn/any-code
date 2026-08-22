import { describe, it, expect, vi, beforeEach } from "vitest";

// mock callLLM：让 agentLoop 测试聚焦增量事件控制流（mock 内手动调 onDelta）
vi.mock("../src/llm", () => ({ callLLM: vi.fn() }));

import { callLLM } from "../src/llm";
import { agentLoop } from "../src/core";
import { EventType } from "../src/type";
import type { ChatMessage } from "../src/type";
import type { ToolContext } from "../src/context";

interface TestCtx extends ToolContext {
    submits: unknown[];
}

const mkCtx = (signal?: AbortSignal): TestCtx => {
    const submits: unknown[] = [];
    return {
        workspace: {} as never,
        eventStream: { submit: (e: unknown) => void submits.push(e) } as never,
        signal: signal ?? new AbortController().signal,
        submits,
    } as never as TestCtx;
};

describe("agentLoop 流式增量事件（core.ts）", () => {
    beforeEach(() => vi.mocked(callLLM).mockReset());

    it("AC-002 流式中发 ASSISTANT_DELTA；AC-003 流结束发 ASSISTANT 整段 + 落盘整条", async () => {
        vi.mocked(callLLM).mockImplementation(
            async (_m, _p, _s, onDelta?: (d: string) => void) => {
                onDelta?.("hel");
                onDelta?.("lo");
                return { role: "assistant", content: "hello" } as never;
            }
        );
        const ctx = mkCtx();
        const messages: ChatMessage[] = [];
        const persisted: ChatMessage[] = [];
        const onMessage = (m: ChatMessage) => {
            persisted.push(m);
        };
        const res = await agentLoop("task", messages, 30, undefined, onMessage, ctx, []);

        // AC-002：两条 ASSISTANT_DELTA（实时态）
        const deltas = ctx.submits.filter(
            (e) => (e as { type: EventType }).type === EventType.ASSISTANT_DELTA
        );
        expect(deltas).toHaveLength(2);
        expect((deltas[0] as { message: string }).message).toBe("hel");
        expect((deltas[1] as { message: string }).message).toBe("lo");

        // AC-003：一条 ASSISTANT 整段定稿
        const finals = ctx.submits.filter(
            (e) => (e as { type: EventType }).type === EventType.ASSISTANT
        );
        expect(finals).toHaveLength(1);
        expect((finals[0] as { message: string }).message).toBe("hello");

        // 落盘：onMessage 收到 user + 整条 assistant；delta 不入盘（persisted 无 delta）
        expect(persisted).toHaveLength(2);
        expect(persisted[0].role).toBe("user");
        expect(persisted[1].role).toBe("assistant");
        expect(persisted[1].content).toBe("hello");
        expect(res.result).toBe("hello");
    });

    it("AC-005 abort 截断：partial 落盘定稿 + 返回 [stopped]", async () => {
        const ac = new AbortController();
        const ctx = mkCtx(ac.signal);
        // mock callLLM：发一段 delta 后 abort，返回截断 partial（仅 content）
        vi.mocked(callLLM).mockImplementation(
            async (_m, _p, _s, onDelta?: (d: string) => void) => {
                onDelta?.("hel");
                ac.abort();
                return { role: "assistant", content: "hel" } as never;
            }
        );
        const messages: ChatMessage[] = [];
        const persisted: ChatMessage[] = [];
        const onMessage = (m: ChatMessage) => {
            persisted.push(m);
        };
        const res = await agentLoop("task", messages, 30, undefined, onMessage, ctx, []);

        expect(res.result).toBe("[stopped]");
        // 截断 partial 落盘（user + assistant partial）
        const assistantPersisted = persisted.filter((m) => m.role === "assistant");
        expect(assistantPersisted).toHaveLength(1);
        expect(assistantPersisted[0].content).toBe("hel");
        // 定稿 ASSISTANT 事件
        const finals = ctx.submits.filter(
            (e) => (e as { type: EventType }).type === EventType.ASSISTANT
        );
        expect(finals).toHaveLength(1);
        expect((finals[0] as { message: string }).message).toBe("hel");
    });
});
