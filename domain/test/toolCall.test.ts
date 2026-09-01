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

    it("防御：tool_calls 含空条目/缺 function 头的项 → 跳过不崩，正常项照常执行（dashscope/GLM 兼容层实测）", async () => {
        const handler = vi.fn(async () => "ok");
        const tools = [mkTool("fakeTool", handler)];
        const ctx = mkCtx();
        const out = await toolCall(
            [
                null as never,
                {} as never,
                { id: "x" } as never,
                mkCall("fakeTool", "tc-ok"),
            ],
            ctx,
            tools
        );
        expect(handler).toHaveBeenCalledTimes(1);
        expect(out.some((m) => m.content === "ok")).toBe(true);
    });
});


// ── 权限判定 seam（SPEC-032）──

import { resolveInteraction } from "../src/pendingInteractions";
import type { PermissionContext } from "../src/permissions";

function mkPermCtx(
    mode: PermissionContext["mode"],
    rules: PermissionContext["rules"] = []
): PermissionContext {
    return {
        mode,
        rules,
        dangerPatterns: ["rm -rf", "sudo"],
        allowOnce: new Set<string>(),
    };
}

const submitted = (ctx: ToolContext) =>
    (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0]
    );

describe("toolCall 权限 seam（SPEC-032）", () => {
    it("AC-001 标准模式 bash → 发 PermissionAsk + 审计 asked，阻塞；裁决 allow_once 后执行", async () => {
        const handler = vi.fn().mockResolvedValue("ran");
        const tools = [mkTool("bash", handler)];
        const ctx = mkCtx();
        ctx.permissions = mkPermCtx("standard");

        const pending = toolCall([mkCall("bash", "tc1", '{"command":"ls -la"}')], ctx, tools, "t1");
        // 落到阻塞：微任务后 handler 未执行
        await new Promise((r) => setTimeout(r, 0));
        expect(handler).not.toHaveBeenCalled();

        const asks = submitted(ctx).filter((e) => e.type === "PermissionAsk");
        expect(asks).toHaveLength(1);
        expect(asks[0].data).toMatchObject({ tool: "bash", pattern: "ls *", danger: false });

        const askedId = asks[0].data.id;
        expect(resolveInteraction(askedId, ["allow_once"])).toBe(true);
        const result = await pending;
        expect(result[0].content).toBe("ran");

        const audits = submitted(ctx).filter((e) => e.type === "Permission");
        expect(audits.map((e) => e.data.phase)).toEqual(["asked", "decided"]);
        expect(audits[1].data.decision).toBe("allow_once");
    });

    it("AC-005 用户拒绝 → 拒绝文案作工具结果，handler 不执行，不缓存", async () => {
        const handler = vi.fn();
        const ctx = mkCtx();
        ctx.permissions = mkPermCtx("standard");
        const pending = toolCall([mkCall("bash", "tc1", '{"command":"ls"}')], ctx, [mkTool("bash", handler)]);
        await new Promise((r) => setTimeout(r, 0));
        const id = submitted(ctx).find((e) => e.type === "PermissionAsk").data.id;
        resolveInteraction(id, ["deny"]);
        const result = await pending;
        expect(handler).not.toHaveBeenCalled();
        expect(result[0].content).toContain("Permission denied");
        expect(ctx.permissions!.allowOnce.size).toBe(0);
    });

    it("AC-006 超时按拒绝（120s），审计记录 timeout", async () => {
        vi.useFakeTimers();
        try {
            const handler = vi.fn();
            const ctx = mkCtx();
            ctx.permissions = mkPermCtx("standard");
            const pending = toolCall([mkCall("bash", "tc1", '{"command":"ls"}')], ctx, [mkTool("bash", handler)]);
            await vi.advanceTimersByTimeAsync(121_000);
            const result = await pending;
            expect(handler).not.toHaveBeenCalled();
            expect(result[0].content).toContain("超时");
            const audits = submitted(ctx).filter((e) => e.type === "Permission");
            expect(audits[audits.length - 1].data.decision).toBe("timeout");
        } finally {
            vi.useRealTimers();
        }
    });

    it("AC-007 标准模式只读工具直通：无 Permission 事件，handler 执行", async () => {
        const handler = vi.fn().mockResolvedValue("ok");
        const ctx = mkCtx();
        ctx.permissions = mkPermCtx("standard");
        const result = await toolCall([mkCall("grep", "tc1", '{"pattern":"x"}')], ctx, [mkTool("grep", handler)]);
        expect(handler).toHaveBeenCalledOnce();
        expect(submitted(ctx).filter((e) => e.type === "Permission" || e.type === "PermissionAsk")).toHaveLength(0);
        expect(result[0].content).toBe("ok");
    });

    it("AC-011 未知工具名（MCP）标准模式 → ask", async () => {
        const handler = vi.fn();
        const ctx = mkCtx();
        ctx.permissions = mkPermCtx("standard");
        const pending = toolCall([mkCall("mcp_x", "tc1", "{}")], ctx, [mkTool("mcp_x", handler)]);
        await new Promise((r) => setTimeout(r, 0));
        expect(handler).not.toHaveBeenCalled();
        expect(submitted(ctx).some((e) => e.type === "PermissionAsk")).toBe(true);
        const id = submitted(ctx).find((e) => e.type === "PermissionAsk").data.id;
        resolveInteraction(id, ["allow_once"]);
        await pending;
    });

    it("AC-012 allow_once 缓存后同类直通；跨 agent（新 ctx）重新 ask", async () => {
        const handler = vi.fn().mockResolvedValue("ok");
        const ctx = mkCtx();
        ctx.permissions = mkPermCtx("standard");
        const tool = mkTool("bash", handler);

        const p1 = toolCall([mkCall("bash", "tc1", '{"command":"ls"}')], ctx, [tool]);
        await new Promise((r) => setTimeout(r, 0));
        resolveInteraction(submitted(ctx).find((e) => e.type === "PermissionAsk").data.id, ["allow_once"]);
        await p1;

        // 同 agent 第二次：缓存命中直通，无新 PermissionAsk
        (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mockClear();
        await toolCall([mkCall("bash", "tc2", '{"command":"ls -la /"}')], ctx, [tool]);
        expect(submitted(ctx).filter((e) => e.type === "PermissionAsk")).toHaveLength(0);

        // 新 agent（新缓存）→ 重新 ask
        const ctx2 = mkCtx();
        ctx2.permissions = mkPermCtx("standard");
        const p2 = toolCall([mkCall("bash", "tc3", '{"command":"ls"}')], ctx2, [tool]);
        await new Promise((r) => setTimeout(r, 0));
        expect(submitted(ctx2).some((e) => e.type === "PermissionAsk")).toBe(true);
        resolveInteraction(submitted(ctx2).find((e) => e.type === "PermissionAsk").data.id, ["deny"]);
        await p2;
    });

    it("allow_always → 内存规则追加，同类命令本 run 内直通；deny 规则永不执行 handler（I-002）", async () => {
        const handler = vi.fn().mockResolvedValue("ok");
        const ctx = mkCtx();
        ctx.permissions = mkPermCtx("standard");
        const tool = mkTool("bash", handler);

        const p1 = toolCall([mkCall("bash", "tc1", '{"command":"npm test"}')], ctx, [tool]);
        await new Promise((r) => setTimeout(r, 0));
        resolveInteraction(submitted(ctx).find((e) => e.type === "PermissionAsk").data.id, ["allow_always"]);
        await p1;
        expect(ctx.permissions!.rules).toContainEqual({ tool: "bash", pattern: "npm *", action: "allow" });

        (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mockClear();
        const r2 = await toolCall([mkCall("bash", "tc2", '{"command":"npm run build"}')], ctx, [tool]);
        expect(r2[0].content).toBe("ok");

        // deny 规则：handler 永不执行
        const denyHandler = vi.fn();
        const ctx3 = mkCtx();
        ctx3.permissions = mkPermCtx("trusted", [{ tool: "mcp_bad", action: "deny" }]);
        const r3 = await toolCall([mkCall("mcp_bad", "tc3", "{}")], ctx3, [mkTool("mcp_bad", denyHandler)]);
        expect(denyHandler).not.toHaveBeenCalled();
        expect(r3[0].content).toContain("Permission denied");
    });

    it("AC-004 信任模式危险基线仍 ask（rm -rf）", async () => {
        const handler = vi.fn();
        const ctx = mkCtx();
        ctx.permissions = mkPermCtx("trusted");
        const pending = toolCall([mkCall("bash", "tc1", '{"command":"rm -rf /tmp/x"}')], ctx, [mkTool("bash", handler)]);
        await new Promise((r) => setTimeout(r, 0));
        expect(handler).not.toHaveBeenCalled();
        const ask = submitted(ctx).find((e) => e.type === "PermissionAsk");
        expect(ask.data.danger).toBe(true);
        resolveInteraction(ask.data.id, ["deny"]);
        await pending;
    });
});
