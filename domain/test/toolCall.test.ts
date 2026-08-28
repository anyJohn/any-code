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

        // SPEC-018：先发 TOOL_START（执行前）+ 后发 TOOL（完成）→ 两次 submit
        expect(ctx.eventStream.submit).toHaveBeenCalledTimes(2);
        const calls = (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock
            .calls;
        const startEvt = calls[0][0];
        const toolEvt = calls[1][0];
        expect(startEvt).toMatchObject({
            type: "ToolStart",
            message: "fakeTool",
            data: { name: "fakeTool", args: { x: 1 } },
            turnId: "t1",
        });
        expect(toolEvt).toMatchObject({
            type: "Tool",
            message: "fakeTool",
            data: { name: "fakeTool", args: { x: 1 }, result: "tool-output" },
            turnId: "t1",
        });
    });

    it("AC-002 SPEC-018 注入 emitProgress → 经其发 TOOL_PROGRESS（turnId 绑定）", async () => {
        // handler 调用 ctx.emitProgress 上抛流式 chunk
        const handler = vi.fn(async (_args: unknown, ctx: ToolContext) => {
            ctx.emitProgress?.("chunk-1");
            ctx.emitProgress?.("chunk-2");
            return "done";
        });
        const tools = [mkTool("streamTool", handler)];
        const ctx = mkCtx();
        await toolCall([mkCall("streamTool", "tc1", "{}")], ctx, tools, "t9");

        const calls = (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock
            .calls.map((c) => c[0]);
        const progressEvts = calls.filter(
            (e) => e.type === "ToolProgress"
        );
        expect(progressEvts).toHaveLength(2);
        expect(progressEvts[0]).toMatchObject({
            message: "chunk-1",
            turnId: "t9",
        });
        expect(progressEvts[1]).toMatchObject({ message: "chunk-2", turnId: "t9" });
        // handler 执行后 emitProgress 清理（不影响后续）
        expect(ctx.emitProgress).toBeUndefined();
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

    it("AC-002 SPEC-022 TOOL 事件 args 长 content 截断（>500）；handler 收原始", async () => {
        const big = "a".repeat(10000);
        const handler = vi.fn().mockResolvedValue("done");
        const tools = [mkTool("write", handler)];
        const ctx = mkCtx();
        await toolCall(
            [
                mkCall(
                    "write",
                    "tc1",
                    JSON.stringify({ filePath: "/x", content: big })
                ),
            ],
            ctx,
            tools,
            "t1"
        );
        const calls = (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock.calls.map(
            (c) => c[0]
        );
        const toolEvt = calls.find((e) => e.type === "Tool");
        expect(toolEvt.data.args.content).toBe(
            "a".repeat(500) + "[truncated, 10000 total]"
        );
        // handler 收到的是原始未截断 args
        expect(handler).toHaveBeenCalledWith(
            { filePath: "/x", content: big },
            ctx
        );
    });
});
