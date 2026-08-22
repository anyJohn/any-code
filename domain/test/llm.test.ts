import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

// mock openai：构造函数返回带 chat.completions.create 的 client
vi.mock("openai", () => ({
    default: vi.fn(() => ({
        chat: { completions: { create: mockCreate } },
    })),
}));

import { callLLM } from "../src/llm";

// callLLM 内部 new Config() 读 env，给齐避免 process.exit(1)
beforeAll(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "http://test";
    process.env.OPENAI_MODEL = "test-model";
});

/** 构造一个 fake chunk 流（async iterable） */
const makeStream = (chunks: unknown[]) => ({
    async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c;
    },
});

describe("callLLM 流式（llm.ts）", () => {
    beforeEach(() => mockCreate.mockReset());

    it("AC-001 消费 chunk 流累积成完整 assistant message（content 拼接 + onDelta）", async () => {
        mockCreate.mockResolvedValue(
            makeStream([
                { choices: [{ delta: { content: "hel" } }] },
                { choices: [{ delta: { content: "lo" } }] },
                { choices: [{ delta: {} }] }, // finish chunk（空 delta）
            ])
        );
        const onDelta = vi.fn();
        const msg = await callLLM([], undefined, undefined, onDelta);

        expect(msg.role).toBe("assistant");
        expect(msg.content).toBe("hello");
        expect(onDelta).toHaveBeenCalledTimes(2);
        expect(onDelta).toHaveBeenNthCalledWith(1, "hel");
        expect(onDelta).toHaveBeenNthCalledWith(2, "lo");
    });

    it("AC-004 tool_calls 按 index 拼装（首片 id+name，后续片 arguments 拼接）", async () => {
        mockCreate.mockResolvedValue(
            makeStream([
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: "tc1",
                                        type: "function",
                                        function: { name: "foo", arguments: '{"a":' },
                                    },
                                ],
                            },
                        },
                    ],
                },
                {
                    choices: [
                        { delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } },
                    ],
                },
            ])
        );
        const msg = (await callLLM([], undefined, undefined)) as {
            tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
        };
        expect(msg.tool_calls).toHaveLength(1);
        expect(msg.tool_calls![0]).toMatchObject({
            id: "tc1",
            type: "function",
            function: { name: "foo", arguments: '{"a":1}' },
        });
    });

    it("AC-005 abort 时返回已累积的截断 message（仅 content，丢 tool_calls）", async () => {
        const ac = new AbortController();
        mockCreate.mockResolvedValue({
            async *[Symbol.asyncIterator]() {
                yield { choices: [{ delta: { content: "hel" } }] };
                yield { choices: [{ delta: { content: "lo" } }] };
                ac.abort();
                throw new Error("aborted");
            },
        });
        const msg = await callLLM([], undefined, ac.signal);
        expect(ac.signal.aborted).toBe(true);
        expect(msg.content).toBe("hello");
        expect(msg.tool_calls).toBeUndefined();
    });

    it("空响应（无 content 无 tool_calls）抛错", async () => {
        mockCreate.mockResolvedValue(makeStream([{ choices: [{ delta: {} }] }]));
        await expect(callLLM([], undefined, undefined)).rejects.toThrow(/no content/);
    });
});
