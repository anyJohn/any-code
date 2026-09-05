import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatCompletionMessageToolCall } from "openai/resources/index";
import { toolCall } from "../src/tools/toolCall";
import { callLLM } from "../src/llm";

// FR-11 子 agent loop 会真调 callLLM——桩掉（isContextOverflowError 用真实现）
vi.mock("../src/llm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/llm")>()),
    callLLM: vi.fn(),
}));
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
    rules: PermissionContext["rules"] = [],
    readOnly: string[] = ["read", "grep", "glob", "explore", "use_skill", "ask_question"]
): PermissionContext {
    return {
        mode,
        rules,
        dangerPatterns: ["rm -rf", "sudo"],
        readOnlyTools: new Set(readOnly),
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

    it("AC-006 ask 挂起等待不超时（SPEC-033 DEC-101）：任意时长推进不自动拒绝，裁决后执行", async () => {
        vi.useFakeTimers();
        try {
            const handler = vi.fn().mockResolvedValue("ok");
            const ctx = mkCtx();
            ctx.permissions = mkPermCtx("standard");
            const pending = toolCall([mkCall("bash", "tc1", '{"command":"ls"}')], ctx, [mkTool("bash", handler)]);
            // 远超原 120s 的推进也不解除挂起
            await vi.advanceTimersByTimeAsync(1_000_000);
            expect(handler).not.toHaveBeenCalled();
            const id = submitted(ctx).find((e) => e.type === "PermissionAsk").data.id;
            resolveInteraction(id, ["allow_once"]);
            const result = await pending;
            expect(handler).toHaveBeenCalledOnce();
            expect(result[0].content).toBe("ok");
            const audits = submitted(ctx).filter((e) => e.type === "Permission");
            expect(audits[audits.length - 1].data.decision).toBe("allow_once");
        } finally {
            vi.useRealTimers();
        }
    });

    it("AC-006b abort 解除挂起的 ask（stop 路径），handler 不执行", async () => {
        const ac = new AbortController();
        const handler = vi.fn();
        const ctx: ToolContext = {
            ...mkCtx(),
            signal: ac.signal,
        };
        ctx.permissions = mkPermCtx("standard");
        const pending = toolCall([mkCall("bash", "tc1", '{"command":"ls"}')], ctx, [mkTool("bash", handler)]);
        await new Promise((r) => setTimeout(r, 0));
        ac.abort();
        const result = await pending;
        expect(handler).not.toHaveBeenCalled();
        expect(result[0].content).toContain("Permission denied");
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


// ── FR-8 并行执行 / FR-10 结构化结果 / AR-7 元数据 ──

import { ToolKit } from "../src/tools";
import type { ToolResult } from "../src/tools";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("toolCall 并行执行（FR-8）", () => {
    it("批内全部 concurrencySafe → 并行执行（总耗时≈最慢者），结果按调用序落盘", async () => {
        const calls: string[] = [];
        const mk = (name: string, delay: number): Tool => ({
            schema: {
                type: "function",
                function: { name, description: "", parameters: { type: "object", properties: {} } },
            } as never,
            handler: async () => {
                calls.push(`start:${name}`);
                await sleep(delay);
                calls.push(`end:${name}`);
                return `done-${name}`;
            },
            meta: { readOnly: true, concurrencySafe: true },
        });
        // A 慢、B 快：并行时 A 先 start、B 先 end
        const tools = [mk("slowA", 60), mk("fastB", 10)];
        const ctx = mkCtx();
        const result = await toolCall(
            [mkCall("slowA", "t1"), mkCall("fastB", "t2")],
            ctx,
            tools,
            "turn"
        );
        expect(result.map((r) => r.content)).toEqual(["done-slowA", "done-fastB"]); // 落盘按调用序
        expect(calls.indexOf("end:fastB")).toBeLessThan(calls.indexOf("end:slowA")); // B 先完成=并行
        // ToolStart 按调用序
        const starts = submitted(ctx).filter((e) => e.type === "ToolStart");
        expect(starts.map((e) => e.data.name)).toEqual(["slowA", "fastB"]);
    }, 10_000);

    it("批内含非并发安全工具（bash）→ 整批退化串行", async () => {
        const order: string[] = [];
        const safeTool: Tool = {
            schema: { type: "function", function: { name: "safeT", description: "", parameters: { type: "object", properties: {} } } } as never,
            handler: async () => {
                order.push("safe-start");
                await sleep(20);
                order.push("safe-end");
                return "s";
            },
            meta: { readOnly: true, concurrencySafe: true },
        };
        const bashLike: Tool = {
            schema: { type: "function", function: { name: "bash", description: "", parameters: { type: "object", properties: {} } } } as never,
            handler: async () => {
                order.push("bash-start");
                await sleep(20);
                order.push("bash-end");
                return "b";
            },
            meta: { readOnly: false, concurrencySafe: false },
        };
        const ctx = mkCtx();
        await toolCall([mkCall("safeT", "t1"), mkCall("bash", "t2")], ctx, [safeTool, bashLike], "turn");
        // 串行：safe 完整跑完才开始 bash
        expect(order).toEqual(["safe-start", "safe-end", "bash-start", "bash-end"]);
    }, 10_000);
});

describe("toolCall 结构化结果（FR-10）", () => {
    it("handler 返回 ToolResult → role:tool 拿 content，Tool 事件带 meta", async () => {
        const handler = vi.fn().mockResolvedValue({
            content: "visible-to-model",
            data: { filePath: "/x/a.ts", exitCode: 0 },
        } satisfies ToolResult);
        const ctx = mkCtx();
        await toolCall([mkCall("edit", "tc1")], ctx, [mkTool("edit", handler)], "turn");
        expect(handler).toHaveBeenCalledOnce();
        const toolEvents = submitted(ctx).filter((e) => e.type === "Tool");
        expect(toolEvents[0].data.result).toBe("visible-to-model");
        expect(toolEvents[0].data.meta).toEqual({ filePath: "/x/a.ts", exitCode: 0 });
    });

    it("handler 返回 undefined → 兜底空串（不炸事件流）", async () => {
        const handler = vi.fn().mockResolvedValue(undefined);
        const ctx = mkCtx();
        const result = await toolCall([mkCall("weird", "tc1")], ctx, [mkTool("weird", handler)], "turn");
        expect(result[0].content).toBe("");
    });
});

describe("toolCall 参数校验（FR-10）", () => {
    it("args 缺 required → 拒绝执行，错误回传模型", async () => {
        const handler = vi.fn();
        const badTool: Tool = {
            schema: {
                type: "function",
                function: {
                    name: "strict",
                    description: "",
                    parameters: {
                        type: "object",
                        properties: { command: { type: "string" } },
                        required: ["command"],
                    },
                },
            } as never,
            handler,
        };
        const ctx = mkCtx();
        const result = await toolCall([mkCall("strict", "tc1", "{}")], ctx, [badTool], "turn");
        expect(handler).not.toHaveBeenCalled();
        expect(result[0].content).toContain("Invalid arguments");
        expect(result[0].content).toContain("command");
    });
});

describe("AR-7 工具元数据", () => {
    it("内置工具 meta：只读集合与权限默认一致，bash/写类非并发安全", () => {
        const byName = Object.fromEntries(
            ToolKit.allTools.map((t) => [t.schema.function.name ?? "", t.meta ?? {}])
        );
        expect(byName["bash"]).toEqual({ readOnly: false, concurrencySafe: false });
        // update_memory 写记忆文件（用户指正 2026-09-04）：非只读
        expect(byName["update_memory"]).toEqual({ readOnly: false, concurrencySafe: false });
        expect(byName["browser_use"]).toEqual({ readOnly: false, concurrencySafe: false });
        expect(byName["create_skill"]).toEqual({ readOnly: false, concurrencySafe: false });
        expect(byName["write"]?.readOnly).toBe(false);
        expect(byName["edit"]?.concurrencySafe).toBe(false);
        for (const ro of ["read", "grep", "glob", "explore", "use_skill", "ask_question"]) {
            expect(byName[ro]?.readOnly).toBe(true);
        }
    });
});

// ── FR-11 sub-agent 能力补全（agent.ts AgentTool）──

import { AgentTool } from "../src/agent";
import type { AgentDefinition } from "../src/agent";

const baseDef: AgentDefinition = {
    name: "sub",
    description: "test sub-agent",
    instruction: "You are a test sub-agent.",
    tools: [],
};
import type { LlmProvider } from "../src/config";

const parentProvider: LlmProvider = {
    apiKey: "k", models: [{ id: "parent-model" }], defaultModel: "parent-model",
    streaming: false, contextWindow: 128000,
};
const altProvider: LlmProvider = {
    apiKey: "k2", models: [{ id: "alt-model" }], defaultModel: "alt-model",
    streaming: false, contextWindow: 128000,
};

function parentCtx(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
        ...mkCtx(),
        llm: parentProvider,
        providers: { parent: parentProvider, alt: altProvider },
        subagentDepth: 0,
        skills: new Map([["my-skill", { name: "my-skill", description: "d", origin: "global" as const, content: "BODY" }]]),
        ...overrides,
    } as ToolContext;
}

/** 探针工具：捕获子 agent 的 ctx 片段 */
function probeTool(capture: (c: ToolContext) => void): Tool {
    return {
        schema: { type: "function", function: { name: "probe", description: "", parameters: { type: "object", properties: {} } } } as never,
        handler: async (_a, c) => {
            capture(c);
            return "probed";
        },
        meta: { readOnly: true, concurrencySafe: true },
    };
}

describe("AgentTool（FR-11 sub-agent 补全）", () => {
    beforeEach(() => vi.mocked(callLLM).mockReset());

    it("深度限制：maxDepth 0 时再委托被拒（防递归）", async () => {
        const def = { ...baseDef, maxDepth: 0 };
        const tool = AgentTool(def);
        const ctx = parentCtx({ subagentDepth: 1 });
        const out = await tool.handler({ task: "x" }, ctx);
        expect(String(out)).toContain("委托深度超限");
    });

    it("def.maxDepth 足够时允许嵌套委托（probe 捕获 subCtx）", async () => {
        let capturedDepth: number | undefined;
        const def = {
            ...baseDef,
            maxDepth: 2,
            tools: [probeTool((c) => (capturedDepth = c.subagentDepth))],
        };
        const tool = AgentTool(def);
        vi.mocked(callLLM)
            .mockResolvedValueOnce({ role: "assistant", content: null, tool_calls: [{ id: "p1", type: "function", function: { name: "probe", arguments: "{}" } }] } as never)
            .mockResolvedValue({ role: "assistant", content: "done" } as never);
        await tool.handler({ task: "x" }, parentCtx({ subagentDepth: 1 }));
        expect(capturedDepth).toBe(2); // 父所在层 1 + 1
    });

    it("def.provider/model 覆盖：子 agent 用指定 provider 的指定模型", async () => {
        let capturedLlm: LlmProvider | undefined;
        const def = {
            ...baseDef,
            tools: [probeTool((c) => (capturedLlm = c.llm))],
            provider: "alt",
            model: "override-model",
        };
        const tool = AgentTool(def);
        vi.mocked(callLLM)
            .mockResolvedValueOnce({ role: "assistant", content: null, tool_calls: [{ id: "p1", type: "function", function: { name: "probe", arguments: "{}" } }] } as never)
            .mockResolvedValue({ role: "assistant", content: "done" } as never);
        await tool.handler({ task: "x" }, parentCtx());
        expect(capturedLlm?.defaultModel).toBe("override-model");
        expect(capturedLlm?.apiKey).toBe("k2");
    });

    it("skills 透传：子 agent 拿到父的技能目录（use_skill 不再空目录）", async () => {
        let capturedSkills: unknown;
        const skillsMap = new Map([["my-skill", { name: "my-skill", description: "d", origin: "global" as const, content: "BODY" }]]);
        const def = {
            ...baseDef,
            tools: [probeTool((c) => (capturedSkills = c.skills))],
        };
        const tool = AgentTool(def);
        vi.mocked(callLLM)
            .mockResolvedValueOnce({ role: "assistant", content: null, tool_calls: [{ id: "p1", type: "function", function: { name: "probe", arguments: "{}" } }] } as never)
            .mockResolvedValue({ role: "assistant", content: "done" } as never);
        await tool.handler({ task: "x" }, parentCtx({ skills: skillsMap }));
        expect(capturedSkills).toBe(skillsMap); // 同一 Map 引用透传
    });
});


// ── FR-12 plan 模式（规划-审批-执行工作流）──

import { createPlanWorkflowTool } from "../src/agent";

const planContent = (n: number) => `## Plan\n1. step ${n}\n## Files\n- a.ts\n## Risks\n- none`;

function planCtx(): ToolContext {
    return {
        ...mkCtx(),
        llm: parentProvider,
        providers: { parent: parentProvider },
        subagentDepth: 0,
    } as ToolContext;
}

/** 驱动 plan 工作流：按消息内容区分规划/执行阶段，Interaction 到达即裁决 */
async function runPlan(answers: string[]) {
    const ctx = planCtx();
    const tool = createPlanWorkflowTool();
    let planRound = 0;
    let execRound = 0;
    vi.mocked(callLLM).mockImplementation(async (messages) => {
        if (messages === undefined) {
            console.log("DEBUG undefined stack:", new Error().stack?.split("\n").slice(1, 5).join(" | "));
            return { role: "assistant", content: "" } as never;
        }
        const isPlanning = JSON.stringify(messages).includes("produce the plan");
        if (isPlanning) {
            planRound += 1;
            return { role: "assistant", content: planContent(planRound) } as never;
        }
        execRound += 1;
        return { role: "assistant", content: `executed-plan-${execRound}` } as never;
    });
    const pending = tool.handler({ task: "复杂任务" }, ctx);
    // 逐个应答裁决（Interaction 事件携带 id）
    await new Promise((r) => setTimeout(r, 5));
    for (const a of answers) {
        const interactions = submitted(ctx).filter((e) => e.type === "Interaction");
        const ev = interactions[interactions.length - 1];
        if (ev) resolveInteraction(ev.data.id, [a]);
        await new Promise((r) => setTimeout(r, 5));
    }
    const out = await pending;
    return { out, ctx };
}

describe("createPlanWorkflowTool（FR-12 plan 模式）", () => {
    beforeEach(() => vi.mocked(callLLM).mockReset());

    it("批准流：Planning 事件（durable data）→ 批准 → 执行返回结果", async () => {
        const { out, ctx } = await runPlan(["批准执行"]);
        expect(out).toBe("executed-plan-1");
        const plannings = submitted(ctx).filter((e) => e.type === "Planning");
        expect(plannings).toHaveLength(1);
        expect(plannings[0].data).toMatchObject({ plan: planContent(1), round: 1 });
    });

    it("修订流：自定义输入 → 重新规划（round 2）→ 批准后执行", async () => {
        const { out, ctx } = await runPlan(["把步骤 1 改成只读", "批准执行"]);
                // 修订后执行首轮（exec 计数独立于规划轮次）
        expect(out).toBe("executed-plan-1");
        const plannings = submitted(ctx).filter((e) => e.type === "Planning");
        expect(plannings).toHaveLength(2);
        expect(plannings[1].data.round).toBe(2);
        // 修订后执行首轮（exec 计数独立于规划轮次）
        expect(out).toBe("executed-plan-1");
    });

    it("取消流：计划未执行", async () => {
        const { out, ctx } = await runPlan(["取消"]);
        expect(out).toContain("未执行");
        expect(submitted(ctx).filter((e) => e.type === "Planning")).toHaveLength(1);
    });

    it("规划阶段只读工具集（不含 bash/write）", async () => {
        let planningTools: string[] | undefined;
        vi.mocked(callLLM).mockImplementation(async (messages, params) => {
            if (messages === undefined) {
                return { role: "assistant", content: "" } as never;
            }
            if (JSON.stringify(messages).includes("produce the plan")) {
                planningTools = ((params as { tools?: Array<{ function: { name: string } }> }).tools ?? []).map(
                    (t) => t.function.name
                );
            }
            return { role: "assistant", content: planContent(1) } as never;
        });
        const ctx = planCtx();
        const tool = createPlanWorkflowTool();
        const pending = tool.handler({ task: "x" }, ctx);
        await new Promise((r) => setTimeout(r, 5));
        const ev = submitted(ctx).filter((e) => e.type === "Interaction")[0];
        resolveInteraction(ev.data.id, ["取消"]);
        await pending;
        expect(planningTools).toBeTruthy();
        expect(planningTools).not.toContain("bash");
        expect(planningTools).not.toContain("write");
        expect(planningTools).toContain("read");
    });
});


// ── code-review 修复回归 ──

describe("toolCall 权限 gate 实时评估（code-review #3）", () => {
    it("批内 allow_always → 同批后续同 pattern 调用直通（不二次弹窗）", async () => {
        const handler = vi.fn().mockResolvedValue("ran");
        const tools = [mkTool("bash", handler)];
        const ctx = mkCtx();
        ctx.permissions = mkPermCtx("standard");
        const pending = toolCall(
            [mkCall("bash", "t1", '{"command":"npm test"}'), mkCall("bash", "t2", '{"command":"npm run build"}')],
            ctx,
            tools,
            "turn"
        );
        await new Promise((r) => setTimeout(r, 0));
        // 第一次 ask → 永久允许
        const asks = submitted(ctx).filter((e) => e.type === "PermissionAsk");
        expect(asks).toHaveLength(1);
        resolveInteraction(asks[0].data.id, ["allow_always"]);
        await pending;
        // 两个都执行了（第二个没有二次 ask）
        expect(handler).toHaveBeenCalledTimes(2);
        expect(submitted(ctx).filter((e) => e.type === "PermissionAsk")).toHaveLength(1);
    });
});

describe("toolCall 并行规则放行审计（code-review #4）", () => {
    it("并行批内规则 allow 的调用也发 decided 审计", async () => {
        const handler = vi.fn().mockResolvedValue("ok");
        const mk = (name: string): Tool => ({
            schema: { type: "function", function: { name, description: "", parameters: { type: "object", properties: {} } } } as never,
            handler,
            meta: { readOnly: true, concurrencySafe: true },
        });
        const ctx = mkCtx();
        ctx.permissions = mkPermCtx("standard", [
            { tool: "grep", pattern: undefined, action: "allow" },
            { tool: "glob", pattern: undefined, action: "allow" },
        ]);
        await toolCall(
            [mkCall("grep", "t1"), mkCall("glob", "t2")],
            ctx,
            [mk("grep"), mk("glob")],
            "turn"
        );
        const audits = submitted(ctx).filter((e) => e.type === "Permission");
        expect(audits).toHaveLength(2);
        expect(audits.every((e) => e.data.phase === "decided" && e.data.action === "allow")).toBe(true);
    });
});

describe("toolCall JSON 非 object args（code-review #8）", () => {
    it("arguments='null' → 错误结果行，不崩整轮", async () => {
        const handler = vi.fn();
        const ctx = mkCtx();
        const result = await toolCall(
            [mkCall("fakeTool", "tc1", "null")],
            ctx,
            [mkTool("fakeTool", handler)],
            "turn"
        );
        expect(handler).not.toHaveBeenCalled();
        expect(result[0].content).toContain("must be a JSON object");
    });
});

describe("并行路径限只读（code-review #5）", () => {
    it("批内含 concurrencySafe 但非 readOnly 的工具 → 退化串行（快照路径可达）", async () => {
        const order: string[] = [];
        const safeWriter: Tool = {
            schema: { type: "function", function: { name: "safeW", description: "", parameters: { type: "object", properties: {} } } } as never,
            handler: async () => {
                order.push("w-start");
                await sleep(20);
                order.push("w-end");
                return "w";
            },
            meta: { readOnly: false, concurrencySafe: true }, // 合法组合：写但可并行
        };
        const reader: Tool = {
            schema: { type: "function", function: { name: "reader", description: "", parameters: { type: "object", properties: {} } } } as never,
            handler: async () => {
                order.push("r-start");
                await sleep(5);
                order.push("r-end");
                return "r";
            },
            meta: { readOnly: true, concurrencySafe: true },
        };
        const ctx = mkCtx();
        await toolCall([mkCall("safeW", "t1"), mkCall("reader", "t2")], ctx, [safeWriter, reader], "turn");
        expect(order).toEqual(["w-start", "w-end", "r-start", "r-end"]); // 串行
    });
});
