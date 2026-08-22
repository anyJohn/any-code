import { describe, it, expect, vi } from "vitest";
import type { ChatCompletionMessageToolCall } from "openai/resources/index";
import { toolCall } from "../src/tools/toolCall";
import { EventType } from "../src/type";
import type { ToolContext } from "../src/context";
import type { Tool } from "../src/tools";

const mkCtx = (): ToolContext => ({
    workspace: {} as never,
    eventStream: { submit: vi.fn() },
    signal: new AbortController().signal,
});

const mkTool = (name: string, handler: ReturnType<typeof vi.fn>): Tool => ({
    schema: {
        type: "function",
        function: { name, description: "", parameters: { type: "object", properties: {} } },
    } as never,
    handler,
});

const mkCall = (
    name: string,
    id = "tc1",
    args = "{}"
): ChatCompletionMessageToolCall => ({
    id,
    type: "function",
    function: { name, arguments: args },
});

describe("toolCall（tools/toolCall.ts）", () => {
    it("AC-005 已知工具按 name 派发，返回 tool-role message 数组", async () => {
        const handler = vi.fn().mockResolvedValue("tool-output");
        const tools = [mkTool("fakeTool", handler)];
        const ctx = mkCtx();
        const result = await toolCall(
            [mkCall("fakeTool")],
            ctx,
            tools,
            "t1"
        );

        expect(handler).toHaveBeenCalledOnce();
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            role: "tool",
            content: "tool-output",
            tool_call_id: "tc1",
        });
    });

    it("AC-006 执行后提交 TOOL 事件 {name,args,result,turnId}", async () => {
        const handler = vi.fn().mockResolvedValue("tool-output");
        const tools = [mkTool("fakeTool", handler)];
        const ctx = mkCtx();
        await toolCall(
            [mkCall("fakeTool", "tc1", '{"x":1}')],
            ctx,
            tools,
            "t1"
        );

        expect(ctx.eventStream.submit).toHaveBeenCalledOnce();
        const evt = (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock
            .calls[0][0];
        expect(evt).toMatchObject({
            type: EventType.TOOL,
            message: "fakeTool",
            data: { name: "fakeTool", args: { x: 1 }, result: "tool-output" },
            turnId: "t1",
        });
    });

    it("AC-007 未知工具名 → [Error] Function not found，不抛异常", async () => {
        const ctx = mkCtx();
        const result = await toolCall([mkCall("nope", "tc2")], ctx, [], "t1");

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            role: "tool",
            tool_call_id: "tc2",
            content: "[Error] Function not found: nope",
        });
        // 未知工具走 continue，不提交 TOOL 事件
        expect(ctx.eventStream.submit).not.toHaveBeenCalled();
    });
});
