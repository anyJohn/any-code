import { describe, it, expect, vi, beforeEach } from "vitest";

// 固定桩 mock callLLM：测 queue 消息迭代边界注入，不调真 LLM
vi.mock("../src/llm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/llm")>()),
    callLLM: vi.fn(),
}));

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

const mkTool = (name: string, handler: () => Promise<string>): Tool => ({
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

describe("queue 消息注入（drainQueuedUserMessages）", () => {
    beforeEach(() => vi.mocked(callLLM).mockReset());

    it("迭代边界注入：消息落在工具结果之后、下一次 LLM 调用之前", async () => {
        // 模拟 main.ts 接线：queueUserMessage 在工具执行期间入队，
        // agentLoop 迭代边界 drain（工具结果已落盘、下一次 LLM 前）
        const queue: { id: string; text: string }[] = [];
        const messages: ChatMessage[] = [];
        const logged: ChatMessage[] = [];
        const ctx = mkCtx();
        ctx.drainQueuedUserMessages = async () => {
            while (queue.length) {
                const item = queue.shift()!;
                const msg: ChatMessage = { role: "user", content: item.text };
                messages.push(msg);
                await Promise.resolve(logged.push(msg));
                ctx.eventStream.submit({ type: "User", message: item.text });
            }
        };
        // 用户在工具执行期间入队（server → AnyAgent.queueUserMessage → userQueue）
        const tool = mkTool("fakeTool", async () => {
            queue.push({ id: "q1", text: "补充要求" });
            return "tool-output";
        });
        vi.mocked(callLLM)
            .mockResolvedValueOnce(
                assistantMsg(null, [toolCallReq("fakeTool")]) as never
            )
            .mockImplementationOnce(async (msgs) => {
                const last = msgs[msgs.length - 1] as ChatMessage;
                expect(last.role).toBe("user");
                expect(last.content).toBe("补充要求");
                return assistantMsg("done") as never;
            });

        const res = await agentLoop(
            "task",
            messages,
            30,
            undefined,
            (m) => void logged.push(m),
            ctx,
            [tool],
            undefined
        );

        expect(res.result).toBe("done");
        // 注入不插在 assistant(tool_calls) 与 tool 结果之间
        expect(messages.map((m) => m.role)).toEqual([
            "user",
            "assistant",
            "tool",
            "user",
            "assistant",
        ]);
        // 注入消息已确认落盘（onMessage 被调）+ User 事件入流
        expect(logged.map((m) => m.content)).toContain("补充要求");
        expect(ctx.eventStream.submit).toHaveBeenCalledWith(
            expect.objectContaining({ type: "User", message: "补充要求" })
        );
    });
});
