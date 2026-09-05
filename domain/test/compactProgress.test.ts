import { describe, it, expect, vi, beforeEach } from "vitest";

// 压缩进度（用户需求 2026-09-05）：summarize 按 provider streaming 配置二选一——
// 流式：onProgress 收 [preparing, summarizing(计数)…, persisting]；非流式：无计数仅阶段；
// 流式失败 → 报错（不兜底重试，用户决策）。

const createMock = vi.fn();
vi.mock("openai", () => ({
    default: class MockOpenAI {
        chat = { completions: { create: createMock } };
        constructor(_cfg: unknown) {}
    },
}));

import { compactMessages } from "../src/compact";
import type { ChatMessage, CompactProgress } from "../src/type";
import type { LlmProvider } from "../src/config";

const provider = (streaming: boolean): LlmProvider =>
    ({
        apiKey: "k",
        baseURL: "http://x",
        models: [{ id: "m" }],
        defaultModel: "m",
        streaming,
    }) as never;

const messages = (): ChatMessage[] =>
    [
        { role: "system", content: "sys" },
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "q2" },
    ] as never;

async function* streamOf(chunks: unknown[]): AsyncIterable<unknown> {
    for (const c of chunks) yield c;
}

describe("compactMessages 进度（阶段 + 流式计数）", () => {
    beforeEach(() => {
        createMock.mockReset();
    });

    it("streaming=true：流式聚合，onProgress = preparing → summarizing(计数) → persisting", async () => {
        createMock.mockResolvedValue(
            streamOf([
                { choices: [{ delta: { content: "hello " } }] },
                { choices: [{ delta: { content: "world" } }] },
            ])
        );
        const events: CompactProgress[] = [];
        const res = await compactMessages(messages(), provider(true), {
            keepN: 1,
            onProgress: (p) => events.push(p),
        });
        expect(res.summary).toBe("hello world");
        expect(events[0]).toEqual({ phase: "preparing" });
        const sums = events.filter((p) => p.phase === "summarizing");
        expect(sums.length).toBeGreaterThanOrEqual(1);
        expect(sums[sums.length - 1].generatedTokens).toBe(3); // "hello world" = 11 chars / 4
        expect(events[events.length - 1]).toEqual({ phase: "persisting" });
    });

    it("streaming=false：非流式，summarizing 无计数（诚实：无信号不编造）", async () => {
        createMock.mockResolvedValue({
            choices: [{ message: { content: "summary" } }],
        });
        const events: CompactProgress[] = [];
        await compactMessages(messages(), provider(false), {
            keepN: 1,
            onProgress: (p) => events.push(p),
        });
        const sums = events.filter((p) => p.phase === "summarizing");
        expect(sums).toEqual([{ phase: "summarizing" }]);
        expect(events[events.length - 1].phase).toBe("persisting");
    });

    it("streaming=true 且 provider 不支持（create 抛错）→ 报错不兜底（用户决策）", async () => {
        createMock.mockImplementation(() => {
            throw new Error("stream unsupported");
        });
        const err = (await compactMessages(messages(), provider(true), {
            keepN: 1,
        }).catch((e: unknown) => e)) as Error;
        expect(err?.message).toBe("stream unsupported");
    });
});
