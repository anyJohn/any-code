import { describe, it, expect, vi, beforeEach } from "vitest";

// 桩 mock callLLM 与 compactMessages：测 agentLoop 自动压缩控制流，不调真 LLM/摘要器
vi.mock("../src/llm", () => ({ callLLM: vi.fn() }));
vi.mock("../src/compact", () => ({
    compactMessages: vi.fn(),
    AUTO_COMPACT_THRESHOLD: 0.75,
}));

import { callLLM } from "../src/llm";
import { compactMessages } from "../src/compact";
import { agentLoop } from "../src/core";
import type { ChatMessage } from "../src/type";
import type { ToolContext } from "../src/context";
import type { Tool } from "../src/tools";

const ctxWith = (contextWindow: number, submit = vi.fn()): ToolContext => ({
    workspace: {} as never,
    eventStream: { submit },
    signal: new AbortController().signal,
    llm: {
        apiKey: "k",
        models: [{ id: "m" }],
        defaultModel: "m",
        streaming: false,
        contextWindow,
    } as never,
});

const mkTool = (name: string, handler: ReturnType<typeof vi.fn>): Tool => ({
    schema: {
        type: "function",
        function: { name, description: "", parameters: { type: "object", properties: {} } },
    } as never,
    handler,
});

const toolCallReq = (name: string, id = "tc1") => ({
    id,
    type: "function" as const,
    function: { name, arguments: "{}" },
});

// 首轮带 tool_calls + 高 usage（驱动循环进入第 2 迭代，顶部触发自动压缩）
const assistantToolWithUsage = (
    name: string,
    prompt_tokens: number
): ChatMessage =>
    ({
        role: "assistant",
        content: null,
        tool_calls: [toolCallReq(name)],
        usage: { prompt_tokens, completion_tokens: 10 },
    }) as never;

describe("agentLoop 自动压缩（core.ts + compact.ts）", () => {
    beforeEach(() => {
        vi.mocked(callLLM).mockReset();
        vi.mocked(compactMessages).mockReset();
    });

    it("AC-003 usage>=75% contextWindow → 触发 compactMessages + onCompact + COMPACT 事件 + lastUsage 重置", async () => {
        const handler = vi.fn().mockResolvedValue("tool-out");
        const tools = [mkTool("fakeTool", handler)];
        // contextWindow=128000，75%=96000；首轮 usage=100000 → 越阈值（首轮带 tool_calls 驱动进入第 2 迭代）
        vi.mocked(callLLM)
            .mockResolvedValueOnce(assistantToolWithUsage("fakeTool", 100000) as never)
            .mockResolvedValueOnce({ role: "assistant", content: "done" } as never);
        const compacted: ChatMessage[] = [
            { role: "system", content: "S" },
            { role: "user", content: "摘要" },
        ] as never;
        vi.mocked(compactMessages).mockResolvedValue({
            messages: compacted,
            summary: "摘要",
            beforeTokens: 100000,
            afterTokens: 500,
            compacted: true,
        } as never);

        const submit = vi.fn();
        const onCompact = vi.fn();
        const messages: ChatMessage[] = [];
        await agentLoop(
            "task",
            messages,
            30,
            undefined,
            undefined,
            ctxWith(128000, submit),
            tools,
            onCompact
        );

        // compactMessages 被调一次
        expect(compactMessages).toHaveBeenCalledOnce();
        // onCompact 用压缩后数组回调（持久化）
        expect(onCompact).toHaveBeenCalledWith(compacted);
        // messages 被原地替换为压缩后数组 + 第二轮 assistant
        expect(messages[0]).toEqual(compacted[0]);
        expect(messages[1]).toEqual(compacted[1]);
        expect(messages[2]).toEqual({ role: "assistant", content: "done" });
        // COMPACT 事件发出，auto=true
        const compactEv = submit.mock.calls.find(
            (c) => c[0]?.type === "Compact"
        );
        expect(compactEv).toBeTruthy();
        expect(compactEv![0].data).toMatchObject({
            auto: true,
            beforeTokens: 100000,
            afterTokens: 500,
        });
    });

    it("未越阈值 → 不触发压缩", async () => {
        const handler = vi.fn().mockResolvedValue("out");
        const tools = [mkTool("fakeTool", handler)];
        vi.mocked(callLLM)
            .mockResolvedValueOnce(assistantToolWithUsage("fakeTool", 50000) as never) // <96000
            .mockResolvedValueOnce({ role: "assistant", content: "done" } as never);
        const messages: ChatMessage[] = [];
        await agentLoop(
            "task",
            messages,
            30,
            undefined,
            undefined,
            ctxWith(128000),
            tools,
            vi.fn()
        );
        expect(compactMessages).not.toHaveBeenCalled();
    });

    it("首迭代无 usage → 不触发压缩（无 tokenizer 也能安全起步）", async () => {
        vi.mocked(callLLM).mockResolvedValue({
            role: "assistant",
            content: "done",
        } as never);
        const messages: ChatMessage[] = [];
        await agentLoop(
            "task",
            messages,
            30,
            undefined,
            undefined,
            ctxWith(128000),
            [],
            vi.fn()
        );
        expect(compactMessages).not.toHaveBeenCalled();
    });
});

