import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

// mock openai：构造函数返回带 chat.completions.create 的 client
vi.mock("openai", () => ({
    default: vi.fn(() => ({
        chat: { completions: { create: mockCreate } },
    })),
}));

import { callLLM } from "../src/llm";
import type { LlmProvider } from "../src/config";

// 流式 provider（默认）；非流式测试用 streaming:false 覆盖
const PROVIDER: LlmProvider = {
    apiKey: "k",
    models: [{ id: "m" }],
    defaultModel: "m",
    streaming: true,
    contextWindow: 128000,
};

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
        const msg = await callLLM([], undefined, undefined, onDelta, PROVIDER);

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
        const msg = (await callLLM([], undefined, undefined, undefined, PROVIDER)) as {
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
        const msg = await callLLM([], undefined, ac.signal, undefined, PROVIDER);
        expect(ac.signal.aborted).toBe(true);
        expect(msg.content).toBe("hello");
        expect(msg.tool_calls).toBeUndefined();
    });

    it("AC-003 provider.streaming=false → 非流式（无 onDelta，整段返回）", async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { role: "assistant", content: "hello" } }],
        });
        const onDelta = vi.fn();
        const msg = await callLLM([], undefined, undefined, onDelta, {
            apiKey: "k",
            models: [{ id: "m" }],
            defaultModel: "m",
            streaming: false,
            contextWindow: 128000,
        });
        expect(onDelta).not.toHaveBeenCalled();
        expect(msg.content).toBe("hello");
        // 非流式 payload 不含 stream:true
        expect(mockCreate.mock.calls[0][0].stream).toBeFalsy();
    });

    it("AC-003b provider.streaming=true → 流式（发 onDelta）", async () => {
        mockCreate.mockResolvedValue(
            makeStream([{ choices: [{ delta: { content: "hi" } }] }])
        );
        const onDelta = vi.fn();
        await callLLM([], undefined, undefined, onDelta, {
            apiKey: "k",
            models: [{ id: "m" }],
            defaultModel: "m",
            streaming: true,
            contextWindow: 128000,
        });
        expect(onDelta).toHaveBeenCalledWith("hi");
        // 流式 payload 含 stream:true
        expect(mockCreate.mock.calls[0][0].stream).toBe(true);
    });

    it("空响应（无 content 无 tool_calls）抛错", async () => {
        mockCreate.mockResolvedValue(makeStream([{ choices: [{ delta: {} }] }]));
        await expect(callLLM([], undefined, undefined, undefined, PROVIDER)).rejects.toThrow(
            /no content/
        );
    });

    it("AC-001 捕获 delta.reasoning_content → onThinkingDelta（SPEC-015）", async () => {
        mockCreate.mockResolvedValue(
            makeStream([
                { choices: [{ delta: { reasoning_content: "think-1" } }] },
                { choices: [{ delta: { reasoning_content: "think-2" } }] },
                { choices: [{ delta: { content: "answer" } }] },
            ])
        );
        const onThinking = vi.fn();
        await callLLM([], undefined, undefined, undefined, PROVIDER, onThinking);
        expect(onThinking).toHaveBeenCalledTimes(2);
        expect(onThinking).toHaveBeenNthCalledWith(1, "think-1");
        expect(onThinking).toHaveBeenNthCalledWith(2, "think-2");
    });

    it("无 reasoning_content 时 onThinkingDelta 不被调（SPEC-015 B-007）", async () => {
        mockCreate.mockResolvedValue(
            makeStream([{ choices: [{ delta: { content: "answer" } }] }])
        );
        const onThinking = vi.fn();
        await callLLM([], undefined, undefined, undefined, PROVIDER, onThinking);
        expect(onThinking).not.toHaveBeenCalled();
    });

    it("AC-001 SPEC-017 累积 reasoning 进返回 message._meta.reasoning", async () => {
        mockCreate.mockResolvedValue(
            makeStream([
                { choices: [{ delta: { reasoning_content: "think-1" } }] },
                { choices: [{ delta: { reasoning_content: "think-2" } }] },
                { choices: [{ delta: { content: "answer" } }] },
            ])
        );
        const msg = await callLLM(
            [],
            undefined,
            undefined,
            undefined,
            PROVIDER,
            vi.fn()
        );
        expect(msg._meta?.reasoning).toBe("think-1think-2");
    });

    it("AC-002 SPEC-017 callLLM 剥离 _meta，payload.messages 不含 _meta", async () => {
        mockCreate.mockResolvedValue(
            makeStream([{ choices: [{ delta: { content: "answer" } }] }])
        );
        await callLLM(
            [
                {
                    role: "user",
                    content: "hi",
                    _meta: { reasoning: "leak" },
                } as never,
            ],
            undefined,
            undefined,
            undefined,
            PROVIDER
        );
        const sentMessages = mockCreate.mock.calls[0][0].messages as Array<
            Record<string, unknown>
        >;
        expect(sentMessages[0]).not.toHaveProperty("_meta");
        expect(sentMessages[0].content).toBe("hi");
    });

    it("无 reasoning_content 时 _meta 不挂载", async () => {
        mockCreate.mockResolvedValue(
            makeStream([{ choices: [{ delta: { content: "answer" } }] }])
        );
        const msg = await callLLM([], undefined, undefined, undefined, PROVIDER);
        expect(msg._meta).toBeUndefined();
    });
});
