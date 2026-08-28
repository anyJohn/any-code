import { describe, it, expect } from "vitest";
import {
    contentToString,
    mergeEvents,
    messagesToEvents,
    type HistoryMessage,
} from "@/lib/sseEvents";
import {
    groupByTurn,
    toRenderItems,
    formatToolCall,
} from "@/lib/renderItems";
import type { AgentEvent } from "@/lib/sseEvents";

const ev = (
    type: AgentEvent["type"],
    message: string,
    extra: Partial<AgentEvent> = {}
): AgentEvent => ({
    id: extra.id ?? `e-${type}-${message}`,
    timestamp: 0,
    type,
    message,
    ...extra,
});

describe("contentToString (TEST-005 TC-005.1)", () => {
    it("string 直返", () => {
        expect(contentToString("hi")).toBe("hi");
    });
    it("null/undefined → 空", () => {
        expect(contentToString(null)).toBe("");
        expect(contentToString(undefined)).toBe("");
    });
    it("多模态数组拼接 text 片段", () => {
        expect(contentToString(["a", { type: "text", text: "b" }, "c"])).toBe(
            "abc"
        );
    });
});

describe("messagesToEvents (TEST-005 TC-005.2, B-002)", () => {
    it("assistant 开新回合，tool_calls 关联 tool 结果", () => {
        const msgs: HistoryMessage[] = [
            { role: "user", content: "hi" },
            {
                role: "assistant",
                content: "thinking",
                tool_calls: [
                    {
                        id: "call_1",
                        function: { name: "bash", arguments: '{"command":"ls"}' },
                    },
                ],
            },
            { role: "tool", tool_call_id: "call_1", content: "file1\nfile2" },
        ];
        const events = messagesToEvents(msgs);
        // User, Iteration, Assistant, Tool
        expect(events.map((e) => e.type)).toEqual([
            "User",
            "Iteration",
            "Assistant",
            "Tool",
        ]);
        const tool = events.find((e) => e.type === "Tool")!;
        expect(tool.data).toEqual({
            name: "bash",
            args: { command: "ls" },
            result: "file1\nfile2",
        });
        // 同回合 turnId 一致
        const turn = events.find((e) => e.type === "Iteration")!.turnId;
        expect(events.find((e) => e.type === "Assistant")!.turnId).toBe(turn);
        expect(tool.turnId).toBe(turn);
    });

    it("非法 JSON arguments → 空 args", () => {
        const msgs: HistoryMessage[] = [
            {
                role: "assistant",
                content: "x",
                tool_calls: [{ id: "c", function: { name: "read", arguments: "{bad" } }],
            },
        ];
        const tool = messagesToEvents(msgs).find((e) => e.type === "Tool")!;
        expect(tool.data).toEqual({ name: "read", args: {}, result: "" });
    });

    it("assistant 无文本时不出 Assistant 事件", () => {
        const msgs: HistoryMessage[] = [
            { role: "assistant", content: null, tool_calls: [] },
        ];
        const types = messagesToEvents(msgs).map((e) => e.type);
        expect(types).toEqual(["Iteration"]); // 仅回合标记
    });
});

describe("groupByTurn (TEST-005 TC-005.3, B-003)", () => {
    it("Iteration 开新回合，Assistant+Tool 归块，System 不归回合", () => {
        const events: AgentEvent[] = [
            ev("System", "sys"),
            ev("Iteration", "Iter 1", { turnId: "t1" }),
            ev("Assistant", "hello", { turnId: "t1" }),
            ev("Tool", "bash", { turnId: "t1", data: { name: "bash", args: {}, result: "" } }),
        ];
        const turns = groupByTurn(events);
        expect(turns).toHaveLength(1);
        expect(turns[0].assistant?.message).toBe("hello");
        expect(turns[0].tools).toHaveLength(1);
    });

    it("两个回合各自成块", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Assistant", "a1", { turnId: "t1" }),
            ev("Iteration", "i2", { turnId: "t2" }),
            ev("Assistant", "a2", { turnId: "t2" }),
        ];
        const turns = groupByTurn(events);
        expect(turns).toHaveLength(2);
        expect(turns[0].assistant?.message).toBe("a1");
        expect(turns[1].assistant?.message).toBe("a2");
    });
});

describe("toRenderItems (TEST-005 TC-005.4, B-003 sub-agent)", () => {
    it("sub-agent 事件成独立块，主流按回合", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Assistant", "a1", { turnId: "t1" }),
            ev("Iteration", "sub-i", { runId: "r1", author: "plan", turnId: "st1" }),
            ev("Assistant", "sub-a", { runId: "r1", author: "plan", turnId: "st1" }),
            ev("Done", "done"),
        ];
        const items = toRenderItems(events);
        // turn(t1) → subagent(r1) → single(Done)
        expect(items.map((i) => i.kind)).toEqual(["turn", "subagent", "single"]);
        const sub = items[1];
        expect(sub.kind).toBe("subagent");
        if (sub.kind === "subagent") {
            expect(sub.author).toBe("plan");
            expect(sub.events).toHaveLength(2);
        }
    });

    it("Compact 事件成独立 single 项，不被回合吞掉", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Assistant", "a1", { turnId: "t1" }),
            ev("Compact", "已压缩上下文 1000→200 tokens", {
                data: { auto: true, beforeTokens: 1000, afterTokens: 200 },
            }),
            ev("Iteration", "i2", { turnId: "t2" }),
            ev("Assistant", "a2", { turnId: "t2" }),
        ];
        const items = toRenderItems(events);
        // turn(t1) → single(Compact) → turn(t2)
        expect(items.map((i) => i.kind)).toEqual(["turn", "single", "turn"]);
        const c = items[1];
        if (c.kind === "single") {
            expect(c.event.type).toBe("Compact");
            expect(c.event.message).toContain("1000→200");
        }
    });

    it("Warning 事件成独立 single 项（SPEC-030 B-003，非终态）", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Assistant", "a1", { turnId: "t1" }),
            ev("Warning", "自动压缩失败：compact boom", {
                data: { message: "compact boom", name: "Error" },
            }),
            ev("Iteration", "i2", { turnId: "t2" }),
        ];
        const items = toRenderItems(events);
        // turn(t1) → single(Warning) → turn(t2) —— Warning 非终态，不进 TERMINAL，不结束流
        expect(items.map((i) => i.kind)).toEqual(["turn", "single", "turn"]);
        const w = items[1];
        if (w.kind === "single") expect(w.event.type).toBe("Warning");
    });
});

describe("messagesToEvents 思考落盘回放（SPEC-017 AC-003/005）", () => {
    it("AC-003 assistant 带 _meta.reasoning → 产 Thinking 事件（在 ASSISTANT 前，同 turnId）", () => {
        const msgs: HistoryMessage[] = [
            { role: "user", content: "hi" },
            {
                role: "assistant",
                content: "answer",
                _meta: { reasoning: "think-full" },
            },
        ];
        const events = messagesToEvents(msgs);
        const types = events.map((e) => e.type);
        // Iteration, Thinking, Assistant
        expect(types).toEqual(["User", "Iteration", "Thinking", "Assistant"]);
        const turn = events.find((e) => e.type === "Iteration")!.turnId;
        const thinking = events.find((e) => e.type === "Thinking")!;
        expect(thinking.message).toBe("think-full");
        expect(thinking.turnId).toBe(turn);
        expect(events.find((e) => e.type === "Assistant")!.turnId).toBe(turn);
    });

    it("AC-005 历史 assistant 无 _meta → 不产 Thinking（向后兼容）", () => {
        const msgs: HistoryMessage[] = [
            { role: "assistant", content: "answer" },
        ];
        const types = messagesToEvents(msgs).map((e) => e.type);
        expect(types).not.toContain("Thinking");
    });
});

describe("groupByTurn Thinking 累积（SPEC-015 AC-003/005）", () => {
    it("AC-003 同回合多个 Thinking 事件累积进 TurnItem.thinking", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Thinking", "think-1", { turnId: "t1" }),
            ev("Thinking", "think-2", { turnId: "t1" }),
            ev("Assistant", "answer", { turnId: "t1" }),
        ];
        const turns = groupByTurn(events);
        expect(turns).toHaveLength(1);
        expect(turns[0].thinking).toBe("think-1think-2");
    });

    it("AC-003 Thinking 在 Assistant 前累积，thinking 独立于 assistant", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Thinking", "reasoning", { turnId: "t1" }),
            ev("Assistant", "final", { turnId: "t1" }),
        ];
        const turns = groupByTurn(events);
        expect(turns[0].thinking).toBe("reasoning");
        expect(turns[0].assistant?.message).toBe("final");
    });

    it("AC-005 无 Thinking 事件 → TurnItem.thinking 为 undefined", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Assistant", "answer", { turnId: "t1" }),
        ];
        const turns = groupByTurn(events);
        expect(turns[0].thinking).toBeUndefined();
    });

    it("思考后跟 ToolStart → thinkingFinished=true（思考完直接调工具，无 content）", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Thinking", "reasoning", { turnId: "t1" }),
            ev("ToolStart", "bash", { turnId: "t1", data: { name: "bash" } }),
            ev("ToolProgress", "out", { turnId: "t1" }),
        ];
        const turns = groupByTurn(events);
        expect(turns[0].thinkingFinished).toBe(true);
        // 未收尾的 Tool：tools 仍空（ToolStart 不入 tools）
        expect(turns[0].tools).toHaveLength(0);
    });

    it("思考后跟 Assistant → thinkingFinished=true", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Thinking", "reasoning", { turnId: "t1" }),
            ev("Assistant", "answer", { turnId: "t1" }),
        ];
        const turns = groupByTurn(events);
        expect(turns[0].thinkingFinished).toBe(true);
    });

    it("只 Thinking 无后续 → thinkingFinished undefined（计时器继续，正确）", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Thinking", "reasoning", { turnId: "t1" }),
        ];
        const turns = groupByTurn(events);
        expect(turns[0].thinkingFinished).toBeUndefined();
    });
});

describe("groupByTurn 流式 delta 累积", () => {
    it("AssistantDelta 累积进当前回合 assistant，定稿 Assistant 替换", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("AssistantDelta", "hel", { turnId: "t1" }),
            ev("AssistantDelta", "lo", { turnId: "t1" }),
            ev("Assistant", "hello", { turnId: "t1" }),
        ];
        const turns = groupByTurn(events);
        expect(turns).toHaveLength(1);
        expect(turns[0].assistant?.message).toBe("hello");
        expect(turns[0].assistant?.type).toBe("Assistant");
    });

    it("delta 无定稿时也累积成 assistant（流式中途渲染）", () => {
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("AssistantDelta", "hel", { turnId: "t1" }),
            ev("AssistantDelta", "lo", { turnId: "t1" }),
        ];
        const turns = groupByTurn(events);
        expect(turns).toHaveLength(1);
        expect(turns[0].assistant?.message).toBe("hello");
    });

    it("历史回放不产 AssistantDelta（只产整段 Assistant）", () => {
        const msgs: HistoryMessage[] = [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
        ];
        const types = messagesToEvents(msgs).map((e) => e.type);
        expect(types).not.toContain("AssistantDelta");
        expect(types).toContain("Assistant");
    });
});

describe("formatToolCall (TEST-005 TC-005.5, B-005)", () => {
    const tc = (name: string, args: Record<string, unknown>) =>
        formatToolCall({ name, args, result: "" });

    it("bash → bash <command>", () => {
        expect(tc("bash", { command: "ls -la" })).toBe("bash ls -la");
    });
    it("read/write → name <filePath>", () => {
        expect(tc("read", { filePath: "/a.ts" })).toBe("read /a.ts");
        expect(tc("write", { filePath: "/b.ts" })).toBe("write /b.ts");
    });
    it("edit → edit <filePath>  «oldBrief»", () => {
        expect(
            tc("edit", { filePath: "/a.ts", oldString: "line1\nline2" })
        ).toBe('edit /a.ts  «line1»');
    });
    it("glob/grep → pattern @ path", () => {
        expect(tc("glob", { pattern: "*.ts", path: "/src" })).toBe('glob "*.ts" @ /src');
        expect(tc("grep", { pattern: "foo" })).toBe('grep "foo"');
    });
    it("explore → explore <dir>", () => {
        expect(tc("explore", { directoryPath: "/d" })).toBe("explore /d");
    });
    it("plan → plan <task>", () => {
        expect(tc("plan", { task: "do x" })).toBe("plan do x");
    });
    it("未知工具 → 返回 name", () => {
        expect(tc("custom", {})).toBe("custom");
    });
});

describe("mergeEvents（持久化 event 并入 messages 重建流，按 user 锚定位置）", () => {
    it("崩溃后重试成功：error 紧跟触发的 User 之后，不漂到末尾", () => {
        const msgs: HistoryMessage[] = [
            { role: "user", content: "do x" }, // 崩溃
            { role: "user", content: "do x" }, // 重试成功
            { role: "assistant", content: "ok" },
        ];
        const persisted = [
            {
                timestamp: 100,
                type: "Error" as const,
                message: "Error executing task: do x",
                data: { message: "boom", name: "Error", stack: "at x" },
            },
        ];
        const merged = mergeEvents(messagesToEvents(msgs), persisted);
        // error 跟在第一个（崩溃的）user 后，而非末尾
        expect(merged.map((e) => e.type)).toEqual([
            "User",
            "Error",
            "User",
            "Iteration",
            "Assistant",
        ]);
        const err = merged[1];
        expect(err.id).toBeTruthy();
        expect((err.data as { message: string }).message).toBe("boom");
    });

    it("一条 user 只认领一个 error；多余 error 末尾追加（降级不丢）", () => {
        const msgs: HistoryMessage[] = [{ role: "user", content: "do x" }];
        const persisted = [
            {
                timestamp: 1,
                type: "Error" as const,
                message: "Error executing task: do x",
                data: {},
            },
            {
                timestamp: 2,
                type: "Error" as const,
                message: "Error executing task: do x",
                data: {},
            },
        ];
        const merged = mergeEvents(messagesToEvents(msgs), persisted);
        expect(merged.map((e) => e.type)).toEqual(["User", "Error", "Error"]);
    });

    it("task 抽不出（message 格式不符）→ 末尾追加，不丢事件", () => {
        const msgs: HistoryMessage[] = [{ role: "user", content: "hi" }];
        const persisted = [
            { timestamp: 1, type: "Error" as const, message: "别的格式", data: {} },
        ];
        const merged = mergeEvents(messagesToEvents(msgs), persisted);
        expect(merged.map((e) => e.type)).toEqual(["User", "Error"]);
    });

    it("无持久化事件 → 原 message 流（补 id）", () => {
        const msgs: HistoryMessage[] = [
            { role: "user", content: "hi" },
            { role: "assistant", content: "yo" },
        ];
        const merged = mergeEvents(messagesToEvents(msgs), []);
        expect(merged.map((e) => e.type)).toEqual([
            "User",
            "Iteration",
            "Assistant",
        ]);
        expect(merged.every((e) => e.id)).toBe(true);
    });
});
