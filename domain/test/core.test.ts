import { describe, it, expect, vi, beforeEach } from "vitest";

// 固定桩 mock callLLM：测 agentLoop 控制流，不调真 LLM（isContextOverflowError 用真实现——AR-9 判定）
vi.mock("../src/llm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/llm")>()),
    callLLM: vi.fn(),
}));

// mock compactMessages：测压缩失败路径（SPEC-030 AC-004/005），保留 AUTO_COMPACT_THRESHOLD 真值
vi.mock("../src/compact", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/compact")>();
    return { ...actual, compactMessages: vi.fn() };
});

import { callLLM } from "../src/llm";
import { compactMessages } from "../src/compact";
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
        expect(res.stopReason).toBe("completed");
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
        expect(res.stopReason).toBe("completed");
    });

    it("FR-28 在途 LLM 调用被 abort 打断 → stopped（abort 经 signal 传入 callLLM）", async () => {
        const ac = new AbortController();
        let observedSignal: AbortSignal | undefined;
        // callLLM(messages, opts, signal, ...)：signal 是第 3 个位置参数
        vi.mocked(callLLM).mockImplementationOnce(
            (function (_m, _o, sig: AbortSignal | undefined) {
                observedSignal = sig;
                // 挂起模拟在途请求；确认进入调用后，模拟用户在 LLM 在途时点停止
                return new Promise((_resolve, reject) => {
                    sig?.addEventListener("abort", () => {
                        const e = new Error("Request was aborted.");
                        e.name = "AbortError";
                        reject(e);
                    });
                    setTimeout(() => ac.abort(), 10);
                });
            }) as never
        );

        const ctx = mkCtx(ac.signal);
        const res = await agentLoop(
            "task",
            [],
            30,
            undefined,
            undefined,
            ctx,
            []
        );

        expect(observedSignal).toBe(ac.signal); // stop 的 signal 真正传进 callLLM
        expect(res.result).toBe("[stopped]");
        expect(res.stopReason).toBe("stopped");
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
        expect(res.stopReason).toBe("stopped");
    });

    it("SPEC-030 AC-004/005：压缩失败 → 发 Warning（非终态）+ 循环继续", async () => {
        vi.mocked(compactMessages).mockRejectedValue(new Error("compact boom"));
        const handler = vi.fn().mockResolvedValue("tool-out");
        const tools = [mkTool("fakeTool", handler)];
        // i=0：带 tool_calls + usage>=75%*contextWindow（800>=750）→ i=1 触发自动压缩
        vi.mocked(callLLM)
            .mockResolvedValueOnce({
                role: "assistant",
                content: null,
                tool_calls: [toolCallReq("fakeTool")],
                usage: { prompt_tokens: 800, completion_tokens: 10 },
            } as never)
            // i=1（压缩失败后继续）：无 tool_calls → 终态
            .mockResolvedValueOnce(assistantMsg("done") as never);

        const submit = vi.fn();
        const ctx: ToolContext = {
            workspace: {} as never,
            eventStream: { submit },
            signal: new AbortController().signal,
            llm: { contextWindow: 1000 } as never,
        };
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

        // AC-004：压缩失败发 Warning（非 Error），data 是 serializeError 的 ErrorPayload
        const warning = submit.mock.calls.find(
            ([e]) => (e as { type: string }).type === "Warning"
        );
        expect(warning).toBeTruthy();
        expect(
            (warning![0] as { error: { message: string } }).error.message
        ).toBe("compact boom");
        // AC-005：循环继续——压缩失败未终止，callLLM 被调 2 次，result=done
        expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(2);
        expect(res.result).toBe("done");
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
        expect(res.stopReason).toBe("max_iterations");
        const warnings = (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).filter((e) => e.type === "Warning");
        expect(warnings.some((e) => e.message.includes("达到上限"))).toBe(true);
    });

    it("AC-002 callLLM 第 6 参 onThinkingDelta → 发 THINKING 事件（SPEC-015）", async () => {
        // callLLM mock 调用第 6 参 onThinkingDelta，模拟思考型模型流
        vi.mocked(callLLM).mockImplementation(
            async (
                _msgs: unknown,
                _params: unknown,
                _signal: unknown,
                _onDelta: unknown,
                _llm: unknown,
                onThinking?: (d: string) => void
            ) => {
                onThinking?.("think-x");
                return assistantMsg("answer") as never;
            }
        );
        const submit = vi.fn();
        const ctx: ToolContext = {
            workspace: {} as never,
            eventStream: { submit },
            signal: new AbortController().signal,
        };
        await agentLoop("task", [], 30, undefined, undefined, ctx, []);

        const thinkingCall = submit.mock.calls.find(
            (c) => c[0]?.type === "Thinking"
        );
        expect(thinkingCall).toBeTruthy();
        expect(thinkingCall![0].message).toBe("think-x");
        // turnId 与同回合 Iteration 一致
        const iterCall = submit.mock.calls.find(
            (c) => c[0]?.type === "Iteration"
        );
        expect(thinkingCall![0].turnId).toBe(iterCall![0].turnId);
    });
});


// ── FR-6 分级压缩 / AR-9 被动压缩 ──

const bigToolResult = (id: string): ChatMessage =>
    ({ role: "tool", tool_call_id: id, content: "x".repeat(400) }) as never;

describe("agentLoop 分级压缩与错误恢复（FR-6 / AR-9）", () => {
    beforeEach(() => vi.mocked(callLLM).mockReset());

    it("FR-6：usage ≥60% 窗口 → 先发 micro Compact（清旧 tool result），不触发全量摘要", async () => {
        // 填满历史：多轮 tool 结果
        const messages: ChatMessage[] = [];
        vi.mocked(callLLM).mockResolvedValue(assistantMsg("done") as never);
        const ctx = mkCtx();
        (ctx as { llm?: unknown }).llm = {
            apiKey: "k", models: [{ id: "m" }], defaultModel: "m",
            streaming: false, contextWindow: 1000,
        };
        for (let i = 0; i < 5; i++) {
            messages.push({ role: "user", content: `q${i}` } as never);
            messages.push(bigToolResult(`t${i}`));
        }
        // 直接调 loop：callLLM 返回 done（无 tool_calls）→ 但 usage 需要 ≥60%……
        // usage 由 callLLM 返回的 message.usage 决定：mock 一次带 usage 的 assistant
        vi.mocked(callLLM).mockReset();
        vi.mocked(callLLM).mockResolvedValueOnce(
            { role: "assistant", content: "mid", usage: { prompt_tokens: 700, completion_tokens: 5 } } as never
        );
        // 后续轮直接完成
        vi.mocked(callLLM).mockResolvedValue(assistantMsg("done") as never);
        // 需要 tool_calls 进入第二轮：改为第一轮带 tool_calls + usage
        vi.mocked(callLLM).mockReset();
        vi.mocked(callLLM)
            .mockResolvedValueOnce(
                { role: "assistant", content: null, tool_calls: [toolCallReq("fakeTool")], usage: { prompt_tokens: 700, completion_tokens: 5 } } as never
            )
            .mockResolvedValue(assistantMsg("done") as never);
        const handler = vi.fn().mockResolvedValue("x".repeat(400));
        const res = await agentLoop("task", messages, 5, undefined, undefined, ctx, [mkTool("fakeTool", handler)]);
        expect(res.stopReason).toBe("completed");
        const compacts = (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock.calls
            .map((c) => c[0])
            .filter((e) => e.type === "Compact");
        expect(compacts.length).toBeGreaterThanOrEqual(1);
        expect(compacts[0].data.micro).toBe(true); // 第一级 micro 先行
    });

    it("AR-9：PTL 错误 → 被动压缩后重试成功（create 侧 mock）", async () => {
        const ctx = mkCtx();
        (ctx as { llm?: unknown }).llm = {
            apiKey: "k", models: [{ id: "m" }], defaultModel: "m",
            streaming: false, contextWindow: 128000,
        };
        // callLLM 第一次抛 PTL，压缩由 mock 的 compactMessages 产出，第二次成功
        vi.mocked(callLLM)
            .mockRejectedValueOnce(new Error("This model's maximum context length is 4096 tokens"))
            .mockResolvedValueOnce(assistantMsg("recovered") as never);
        vi.mocked(compactMessages).mockResolvedValueOnce({
            messages: [{ role: "user", content: "summary" } as never],
            summary: "s",
            beforeTokens: 100,
            afterTokens: 50,
            compacted: true,
        });
        const res = await agentLoop("task", [], 5, undefined, undefined, ctx, []);
        expect(res.stopReason).toBe("completed");
        expect(res.result).toBe("recovered");
        const compacts = (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock.calls
            .map((c) => c[0])
            .filter((e) => e.type === "Compact");
        expect(compacts.some((e) => e.message.includes("被动压缩"))).toBe(true);
    });
});

describe("agentLoop 多模态用户消息（SPEC-043 B-003/I-001）", () => {
    beforeEach(() => vi.mocked(callLLM).mockReset());

    it("视觉模型（ctx.vision）+ images → user 消息为 parts（text + image_url，AC-001）", async () => {
        vi.mocked(callLLM).mockResolvedValueOnce(assistantMsg("ok") as never);
        const ctx = mkCtx();
        ctx.vision = true;
        const messages: ChatMessage[] = [];
        await agentLoop("看图", messages, undefined, undefined, undefined, ctx, [], undefined, {
            content: "看图",
            images: [{ mimeType: "image/png", base64: "aGk=" }],
        });
        expect(messages).toHaveLength(2);
        const content = messages[0].content as unknown as Array<Record<string, unknown>>;
        expect(Array.isArray(content)).toBe(true);
        expect(content[0]).toEqual({ type: "text", text: "看图" });
        expect(content[1]).toEqual({
            type: "image_url",
            image_url: { url: "data:image/png;base64,aGk=" },
        });
    });

    it("vision 未声明（缺省开）→ 直接发 parts（DEC-159：未声明 = 支持）", async () => {
        vi.mocked(callLLM).mockResolvedValueOnce(assistantMsg("ok") as never);
        const ctx = mkCtx(); // vision 未声明 = 支持（缺省翻开）
        const messages: ChatMessage[] = [];
        await agentLoop("看图", messages, undefined, undefined, undefined, ctx, [], undefined, {
            content: "看图",
            images: [{ mimeType: "image/png", base64: "aGk=" }],
        });
        const content = messages[0].content as unknown as Array<Record<string, unknown>>;
        expect(Array.isArray(content)).toBe(true);
        expect(content[1]).toEqual({
            type: "image_url",
            image_url: { url: "data:image/png;base64,aGk=" },
        });
    });

    it("显式 vision:false + images → 降级为文本占位，无 image_url 块（AC-002/I-001）", async () => {
        vi.mocked(callLLM).mockResolvedValueOnce(assistantMsg("ok") as never);
        const ctx = mkCtx();
        ctx.vision = false; // 显式声明不支持
        const messages: ChatMessage[] = [];
        await agentLoop("看图", messages, undefined, undefined, undefined, ctx, [], undefined, {
            content: "看图",
            images: [{ mimeType: "image/png", base64: "aGk=" }],
        });
        const content = messages[0].content as string;
        expect(typeof content).toBe("string");
        expect(content).toContain("不支持视觉输入");
        expect(content).not.toContain("image_url");
    });
});

describe("agentLoop 图片降级（SPEC-043 DEC-159：缺省开 + provider 拒绝兜底）", () => {
    beforeEach(() => vi.mocked(callLLM).mockReset());

    it("provider 4xx 拒绝图片 → 去图转文本占位后同轮重试成功", async () => {
        const ctx = mkCtx();
        (ctx as { llm?: unknown }).llm = {
            apiKey: "k", models: [{ id: "m" }], defaultModel: "m",
            streaming: false, contextWindow: 128000,
        };
        // 第一次：带 image_url 的请求被拒（4xx + 图片相关文案）；第二次：去图后成功
        vi.mocked(callLLM)
            .mockRejectedValueOnce(
                Object.assign(new Error("Invalid content type: image_url is not supported"), {
                    status: 400,
                })
            )
            .mockResolvedValueOnce(assistantMsg("recovered") as never);
        const messages: ChatMessage[] = [];
        const res = await agentLoop("看图", messages, 5, undefined, undefined, ctx, [], undefined, {
            content: "看图",
            images: [{ mimeType: "image/png", base64: "aGk=" }],
        });
        expect(res.stopReason).toBe("completed");
        expect(res.result).toBe("recovered");
        // 重发时该消息已无 image_url，只剩文本占位
        const content = messages[0].content as string;
        expect(typeof content).toBe("string");
        expect(content).not.toContain("image_url");
        expect(content).toContain("rejected image input");
        // 用户可见提示
        const warnings = (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock.calls
            .map((c) => c[0])
            .filter((e) => e.type === "Warning");
        expect(warnings.some((e) => e.message.includes("不支持图片输入"))).toBe(true);
        // ctx.vision 已翻转，后续轮次不再注入工具结果图片
        expect(ctx.vision).toBe(false);
    });

    it("无图片的普通 4xx → 不降级，原样上抛", async () => {
        const ctx = mkCtx();
        (ctx as { llm?: unknown }).llm = {
            apiKey: "k", models: [{ id: "m" }], defaultModel: "m",
            streaming: false, contextWindow: 128000,
        };
        vi.mocked(callLLM).mockRejectedValueOnce(
            Object.assign(new Error("Invalid API key"), { status: 401 })
        );
        await expect(
            agentLoop("task", [], 5, undefined, undefined, ctx, [])
        ).rejects.toThrow("Invalid API key");
        expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(1); // 未重试
    });

    it("降级只做一次：去图后仍失败 → 上抛（不循环）", async () => {
        const ctx = mkCtx();
        (ctx as { llm?: unknown }).llm = {
            apiKey: "k", models: [{ id: "m" }], defaultModel: "m",
            streaming: false, contextWindow: 128000,
        };
        const imgErr = () =>
            Object.assign(new Error("image_url not supported"), { status: 400 });
        vi.mocked(callLLM)
            .mockRejectedValueOnce(imgErr())
            .mockRejectedValueOnce(imgErr());
        await expect(
            agentLoop("看图", [], 5, undefined, undefined, ctx, [], undefined, {
                content: "看图",
                images: [{ mimeType: "image/png", base64: "aGk=" }],
            })
        ).rejects.toThrow("image_url not supported");
        expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(2); // 首轮 + 一次降级重试
    });
});

describe("toolCall 图片结果注入（SPEC-043 B-002）", () => {
    beforeEach(() => vi.mocked(callLLM).mockReset());

    it("handler 返回 images + 视觉 ctx → 合成 user 消息带 image_url 块", async () => {
        const { toolCall } = await import("../src/tools/toolCall.js");
        const ctx = mkCtx() as never as import("../src/context").ToolContext;
        ctx.vision = true;
        ctx.eventStream = { submit: vi.fn() } as never;
        const tool: import("../src/tools/index").Tool = {
            schema: {
                type: "function",
                function: {
                    name: "read",
                    description: "t",
                    parameters: { type: "object", properties: {} },
                },
            },
            handler: vi.fn().mockResolvedValue({
                content: "[Image file: a.png]",
                images: [{ mimeType: "image/png", base64: "aGk=" }],
            }),
            meta: { readOnly: true, concurrencySafe: true },
        };
        const call = {
            id: "tc1",
            type: "function" as const,
            function: { name: "read", arguments: "{}" },
        };
        const result = await toolCall([call], ctx, [tool]);
        // tool result（纯文本）+ 合成 user 消息（image_url）
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe("tool");
        expect(result[1].role).toBe("user");
        const parts = result[1].content as unknown as Array<Record<string, unknown>>;
        expect(parts[0].type).toBe("text");
        expect(parts[1]).toEqual({
            type: "image_url",
            image_url: { url: "data:image/png;base64,aGk=" },
        });
    });

    it("显式 vision:false ctx → 合成消息为文本占位，无 image_url（I-001）", async () => {
        const { toolCall } = await import("../src/tools/toolCall.js");
        const ctx = mkCtx() as never as import("../src/context").ToolContext;
        ctx.vision = false; // 显式声明不支持（DEC-159）
        ctx.eventStream = { submit: vi.fn() } as never;
        const tool: import("../src/tools/index").Tool = {
            schema: {
                type: "function",
                function: {
                    name: "read",
                    description: "t",
                    parameters: { type: "object", properties: {} },
                },
            },
            handler: vi.fn().mockResolvedValue({
                content: "[Image file: a.png]",
                images: [{ mimeType: "image/png", base64: "aGk=" }],
            }),
            meta: { readOnly: true, concurrencySafe: true },
        };
        const call = {
            id: "tc1",
            type: "function" as const,
            function: { name: "read", arguments: "{}" },
        };
        const result = await toolCall([call], ctx, [tool]);
        expect(result).toHaveLength(2);
        const content = result[1].content as string;
        expect(typeof content).toBe("string");
        expect(content).toContain("does not support vision");
    });
});
