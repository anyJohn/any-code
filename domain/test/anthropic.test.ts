import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toAnthropicMessages, anthropicCall } from "../src/providers/anthropic";
import type { ChatMessage } from "../src/type";
import type { LlmProvider } from "../src/config";

// AR-15：Anthropic Messages 协议适配（fetch 全局 mock）

const PROVIDER: LlmProvider = {
    apiKey: "sk-ant-test",
    models: [{ id: "claude-test" }],
    defaultModel: "claude-test",
    streaming: true,
    contextWindow: 200000,
    protocol: "anthropic",
};

const sse = (events: Array<[string, unknown]>): Response => {
    const text = events
        .map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
        .join("");
    const stream = new ReadableStream({
        start(c) {
            c.enqueue(new TextEncoder().encode(text));
            c.close();
        },
    });
    return new Response(stream, { status: 200 });
};

describe("toAnthropicMessages（AR-15 消息映射）", () => {
    it("system 提取到顶层；tool 结果转 tool_result 块；assistant tool_calls 转 tool_use 块", () => {
        const messages: ChatMessage[] = [
            { role: "system", content: "be nice" } as never,
            { role: "user", content: "hi" } as never,
            {
                role: "assistant",
                content: null,
                tool_calls: [
                    { id: "t1", type: "function", function: { name: "ls", arguments: '{"x":1}' } },
                ],
            } as never,
            { role: "tool", tool_call_id: "t1", content: "out" } as never,
        ];
        const { system, messages: out } = toAnthropicMessages(messages);
        expect(system).toBe("be nice");
        expect(out[0]).toEqual({ role: "user", content: "hi" });
        expect(out[1].role).toBe("assistant");
        expect(out[1].content).toEqual([
            { type: "tool_use", id: "t1", name: "ls", input: { x: 1 } },
        ]);
        expect(out[2]).toEqual({
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "t1", content: "out" }],
        });
    });
});

describe("anthropicCall（AR-15 流式/非流式）", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("流式：SSE 事件 → content/usage/tool_calls 归一化 + 回调", async () => {
        fetchMock.mockResolvedValue(
            sse([
                ["message_start", { message: { usage: { input_tokens: 120 } } }],
                ["content_block_start", { index: 0, content_block: { type: "text" } }],
                ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "hel" } }],
                ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "lo" } }],
                ["content_block_stop", { index: 0 }],
                [
                    "message_delta",
                    { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
                ],
                ["message_stop", {}],
            ])
        );
        const onDelta = vi.fn();
        const res = await anthropicCall(
            [{ role: "user", content: "hi" } as never],
            undefined,
            undefined,
            PROVIDER,
            { onDelta }
        );
        expect(res.content).toBe("hello");
        expect(res.usage).toEqual({ prompt_tokens: 120, completion_tokens: 7 });
        expect(onDelta).toHaveBeenCalledTimes(2);

        // 请求形状：端点/鉴权/max_tokens 必填
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://api.anthropic.com/v1/messages");
        expect(init.headers["x-api-key"]).toBe("sk-ant-test");
        expect(init.headers["anthropic-version"]).toBe("2023-06-01");
        expect(init.body).toContain('"stream":true');
        expect(init.body).toContain('"max_tokens":8192');
    });

    it("工具调用：input_json_delta → tool_calls（JSON 参数归一化）+ 心跳", async () => {
        fetchMock.mockResolvedValue(
            sse([
                ["message_start", { message: { usage: { input_tokens: 10 } } }],
                ["content_block_start", { index: 0, content_block: { type: "tool_use", id: "tu1", name: "bash" } }],
                ["content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"comm' } }],
                ["content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: 'and":"ls"}' } }],
                ["content_block_stop", { index: 0 }],
                ["message_delta", { usage: { output_tokens: 20 } }],
                ["message_stop", {}],
            ])
        );
        const progress: number[] = [];
        const res = await anthropicCall(
            [{ role: "user", content: "ls please" } as never],
            undefined,
            undefined,
            PROVIDER,
            { onToolArgProgress: (i) => progress.push(i.bytes) }
        );
        expect(res.tool_calls).toEqual([
            { id: "tu1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
        ]);
        expect(progress.length).toBeGreaterThanOrEqual(2);
    });

    it("非流式：content blocks → 归一化（streaming:false）", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                content: [
                    { type: "text", text: "answer" },
                    { type: "tool_use", id: "tu9", name: "read", input: { filePath: "a.ts" } },
                ],
                usage: { input_tokens: 5, output_tokens: 9 },
            }),
        } as never);
        const res = await anthropicCall(
            [{ role: "user", content: "hi" } as never],
            undefined,
            undefined,
            { ...PROVIDER, streaming: false },
            {}
        );
        expect(res.content).toBe("answer");
        expect(res.tool_calls?.[0]?.function.name).toBe("read");
        expect(JSON.parse(res.tool_calls![0].function.arguments)).toEqual({ filePath: "a.ts" });
        expect(res.usage).toEqual({ prompt_tokens: 5, completion_tokens: 9 });
    });

    it("HTTP 错误 → 抛出（withRetry 层负责重试分类）", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            text: async () => "server error",
        } as never);
        await expect(
            anthropicCall([{ role: "user", content: "hi" } as never], undefined, undefined, PROVIDER, {})
        ).rejects.toThrow("Anthropic API 500");
    });

    it("空响应 → 抛错（isRetryableError 判定走重试分类）", async () => {
        fetchMock.mockResolvedValue(
            sse([
                ["message_start", { message: { usage: { input_tokens: 1 } } }],
                ["message_stop", {}],
            ])
        );
        await expect(
            anthropicCall([{ role: "user", content: "hi" } as never], undefined, undefined, PROVIDER, {})
        ).rejects.toThrow("LLM returned no content");
    });
});
