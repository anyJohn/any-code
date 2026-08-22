import { describe, it, expect, vi, beforeEach } from "vitest";

// 固定桩 mock callLLM：测 agentLoop 控制流，不调真 LLM
vi.mock("../src/llm", () => ({ callLLM: vi.fn() }));

import { callLLM } from "../src/llm";
import { agentLoop } from "../src/core";
import type { ChatMessage } from "../src/type";
import type { ToolContext } from "../src/context";
import type { Tool } from "../src/tools";

const mkCtx = (signal?: AbortSignal): ToolContext => ({
    workspace: {} as never,
    eventStream: { submit: vi.fn() },
    signal: signal ?? new AbortController().signal,
});

const mkTool = (name: string, handler: ReturnType<typeof vi.fn>): Tool => ({
    schema: {
        type: "function",
        function: { name, description: "", parameters: { type: "object", properties: {} } },
    } as never,
    handler,
});

const assistantMsg = (
    content: string | null,
    tool_calls?: unknown[]
): ChatMessage => ({ role: "assistant", content, tool_calls } as never);

const toolCallReq = (name: string, id = "tc1") => ({
    id,
    type: "function" as const,
    function: { name, arguments: "{}" },
});

describe("agentLoop（core.ts）", () => {
    beforeEach(() => vi.mocked(callLLM).mockReset());

    it("AC-001 有 tool_calls → 执行 → 回灌 → 循环 → 返回末次 content", async () => {
        const handler = vi.fn().mockResolvedValue("tool-output");
        const tools = [mkTool("fakeTool", handler)];
        vi.mocked(callLLM)
            .mockResolvedValueOnce(
                assistantMsg(null, [toolCallReq("fakeTool")]) as never
            )
            .mockResolvedValueOnce(assistantMsg("done") as never);

        const ctx = mkCtx();
        const messages: ChatMessage[] = [];
        const res = await agentLoop(
            "task",
            messages,
            30,
            undefined,
            undefined,
            ctx,
            tools
        );

        expect(handler).toHaveBeenCalledOnce();
        expect(res.result).toBe("done");
        // user + assistant(tool_calls) + tool(result) + assistant(done)
        expect(messages).toHaveLength(4);
        expect(messages[0].role).toBe("user");
        expect(messages[1].role).toBe("assistant");
        expect((messages[1] as never as { tool_calls?: unknown[] }).tool_calls)
            .toHaveLength(1);
        expect(messages[2].role).toBe("tool");
        expect(messages[2].content).toBe("tool-output");
        expect(messages[3].role).toBe("assistant");
        expect(messages[3].content).toBe("done");
    });

    it("AC-002 无 tool_calls → 单次 callLLM 后直接返回", async () => {
        vi.mocked(callLLM).mockResolvedValueOnce(assistantMsg("hello") as never);
        const ctx = mkCtx();
        const messages: ChatMessage[] = [];
        const res = await agentLoop(
            "task",
            messages,
            30,
            undefined,
            undefined,
            ctx,
            []
        );

        expect(vi.mocked(callLLM)).toHaveBeenCalledOnce();
        expect(res.result).toBe("hello");
        expect(messages).toHaveLength(2); // user + assistant
        expect(messages[1].content).toBe("hello");
    });

    it("AC-003 signal aborted → 不再调 callLLM，返回 [stopped]", async () => {
        const ac = new AbortController();
        ac.abort();
        const ctx = mkCtx(ac.signal);
        const messages: ChatMessage[] = [];
        const res = await agentLoop(
            "task",
            messages,
            30,
            undefined,
            undefined,
            ctx,
            []
        );

        expect(vi.mocked(callLLM)).not.toHaveBeenCalled();
        expect(res.result).toBe("[stopped]");
    });

    it("AC-004 达 maxIter → 停止不无限循环", async () => {
        vi.mocked(callLLM).mockResolvedValue(
            assistantMsg(null, [toolCallReq("fakeTool")]) as never
        );
        const handler = vi.fn().mockResolvedValue("out");
        const tools = [mkTool("fakeTool", handler)];
        const ctx = mkCtx();
        const messages: ChatMessage[] = [];
        const res = await agentLoop(
            "task",
            messages,
            2,
            undefined,
            undefined,
            ctx,
            tools
        );

        expect(res.result).toBe("Max iterations reached");
        expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(2);
    });
});
