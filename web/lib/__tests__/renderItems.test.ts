import { describe, it, expect } from "vitest";
import {
    contentToString,
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
