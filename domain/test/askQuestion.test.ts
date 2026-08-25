import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { askQuestionFunc, ASK_TIMEOUT_MS } from "../src/tools/functions/askQuestion";
import { resolveInteraction } from "../src/pendingInteractions";
import { ToolKit } from "../src/tools";
import type { ToolContext } from "../src/context";
import { EventType } from "../src/type";

describe("ask_question schema/分组（AC-001）", () => {
    it("在 allTools + executeTools，不在 readOnly", () => {
        const names = (ts: { schema: { function: { name: string } } }[]) =>
            ts.map((t) => t.schema.function.name);
        expect(names(ToolKit.allTools)).toContain("ask_question");
        expect(names(ToolKit.executeTools)).toContain("ask_question");
        expect(names(ToolKit.readOnlyTools)).not.toContain("ask_question");
    });

    it("schema questions minItems1/maxItems5、options min2/max4", () => {
        const sch = ToolKit.allTools.find(
            (t) => t.schema.function.name === "ask_question"
        )!.schema as {
            function: {
                parameters: {
                    properties: { questions: { minItems: number; maxItems: number; items: { properties: { options: { minItems: number; maxItems: number } } } } };
                };
            };
        };
        const q = sch.function.parameters.properties.questions;
        expect(q.minItems).toBe(1);
        expect(q.maxItems).toBe(5);
        expect(q.items.properties.options.minItems).toBe(2);
        expect(q.items.properties.options.maxItems).toBe(4);
    });
});

const mkCtx = (signal?: AbortSignal): ToolContext => ({
    workspace: {} as never,
    eventStream: { submit: vi.fn() },
    signal: signal ?? new AbortController().signal,
});

describe("ask_question handler（AC-003）", () => {
    it("发 INTERACTION 事件（data 含 id+questions）", async () => {
        const ctx = mkCtx();
        const p = askQuestionFunc(
            { questions: [{ question: "q1", options: ["a", "b"] }] },
            ctx
        );
        const submit = ctx.eventStream.submit as unknown as ReturnType<typeof vi.fn>;
        const ev = submit.mock.calls.find((c) => c[0]?.type === EventType.INTERACTION);
        expect(ev).toBeTruthy();
        expect(ev![0].data).toMatchObject({
            id: expect.any(String),
            questions: [{ question: "q1", options: ["a", "b"] }],
        });
        // 收尾：resolve 掉 pending
        resolveInteraction(ev![0].data.id, ["a"]);
        await p;
    });

    it("answered → return 'Q: ..\\nA: ..' 多行（多选 join ', '）", async () => {
        const ctx = mkCtx();
        const p = askQuestionFunc(
            {
                questions: [
                    { question: "单选", options: ["x", "y"] },
                    { question: "多选", options: ["a", "b", "c"], multiSelect: true },
                ],
            },
            ctx
        );
        const submit = ctx.eventStream.submit as unknown as ReturnType<typeof vi.fn>;
        const ev = submit.mock.calls.find((c) => c[0]?.type === EventType.INTERACTION);
        resolveInteraction(ev![0].data.id, ["x", "a, b"]);
        const result = await p;
        expect(result).toContain("Q: 单选\nA: x");
        expect(result).toContain("Q: 多选\nA: a, b");
    });

    it("空 questions → return 错误串，不发 INTERACTION", async () => {
        const ctx = mkCtx();
        const result = await askQuestionFunc({ questions: [] }, ctx);
        expect(result).toContain("[Error]");
        const submit = ctx.eventStream.submit as unknown as ReturnType<typeof vi.fn>;
        expect(
            submit.mock.calls.some((c) => c[0]?.type === EventType.INTERACTION)
        ).toBe(false);
    });

    it("超时 → return best-judgment sentinel（不 reject）", async () => {
        vi.useFakeTimers();
        try {
            const ctx = mkCtx();
            const p = askQuestionFunc(
                { questions: [{ question: "q1" }] },
                ctx
            );
            await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS + 1);
            const result = await p;
            expect(result).toContain("best judgment");
        } finally {
            vi.useRealTimers();
        }
    });

    it("signal abort → return abort sentinel（不 reject，agentLoop 下轮 STOPPED）", async () => {
        const ac = new AbortController();
        const ctx = mkCtx(ac.signal);
        const p = askQuestionFunc({ questions: [{ question: "q1" }] }, ctx);
        ac.abort();
        const result = await p;
        expect(result).toContain("stopped");
    });
});
