import { describe, it, expect } from "vitest";
import { groupByTurn, toRenderItems, formatToolCall } from "@/lib/renderItems";
import type { AgentEvent } from "@/lib/sseEvents";

const ev = <T extends AgentEvent["type"]>(
    type: T,
    message: string,
    extra: Partial<Extract<AgentEvent, { type: T }>> = {}
): Extract<AgentEvent, { type: T }> =>
    ({
        id: extra.id ?? `e-${type}-${message}`,
        timestamp: 0,
        type,
        message,
        ...extra,
    } as Extract<AgentEvent, { type: T }>);

describe("groupByTurn (TEST-005 TC-005.3, B-003)", () => {
    it("Iteration 开新回合，Assistant+Tool 归块，System 不归回合", () => {
        const events: AgentEvent[] = [
            ev("System", "sys"),
            ev("Iteration", "Iter 1", { turnId: "t1" }),
            ev("Assistant", "hello", { turnId: "t1" }),
            ev("Tool", "bash", {
                turnId: "t1",
                data: { name: "bash", args: {}, result: "" },
            }),
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
            ev("Iteration", "sub-i", {
                runId: "r1",
                author: "plan",
                turnId: "st1",
            }),
            ev("Assistant", "sub-a", {
                runId: "r1",
                author: "plan",
                turnId: "st1",
            }),
            ev("Done", "done"),
        ];
        const items = toRenderItems(events);
        // turn(t1) → subagent(r1) → single(Done)
        expect(items.map((i) => i.kind)).toEqual([
            "turn",
            "subagent",
            "single",
        ]);
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
                error: { message: "compact boom", name: "Error" },
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
            ev("ToolStart", "bash", {
                turnId: "t1",
                data: { name: "bash", args: {} },
            }),
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

    it("只 Thinking 无后续 → thinkingFinished undefined（open 状态留给 ThinkingBlock live 门兜底）", () => {
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
        ).toBe("edit /a.ts  «line1»");
    });
    it("glob/grep → pattern @ path", () => {
        expect(tc("glob", { pattern: "*.ts", path: "/src" })).toBe(
            'glob "*.ts" @ /src'
        );
        expect(tc("grep", { pattern: "foo" })).toBe('grep "foo"');
    });
    it("explore → explore <dir>", () => {
        expect(tc("explore", { directoryPath: "/d" })).toBe("explore /d");
    });
    it("plan → plan <task>", () => {
        expect(tc("plan", { task: "do x" })).toBe("plan do x");
    });
    it("web_search → 显示搜索词；web_fetch → 显示 url（不展内容）", () => {
        expect(tc("web_search", { query: "nodejs" })).toBe(
            'web_search "nodejs"'
        );
        expect(tc("web_fetch", { url: "https://example.com/x" })).toBe(
            "web_fetch https://example.com/x"
        );
    });
    it("未知工具 → 返回 name", () => {
        expect(tc("custom", {})).toBe("custom");
    });
});

describe("reload 重放 durable 事件日志（SPEC-030 AC-009/010，定位 by construction）", () => {
    it("AC-009 崩溃后重试成功：error 在对应回合位置，不漂末尾（日志有序，非 content-match）", () => {
        // 持久化事件日志即顺序：User1 → Error(t1) → User2 → Iteration(t2) → Assistant(t2)
        const events: AgentEvent[] = [
            ev("User", "do x"),
            ev("Error", "Error executing task: do x", {
                error: { message: "boom", name: "Error", stack: "at x" },
            }),
            ev("User", "do x"),
            ev("Iteration", "Iter 1", { turnId: "t2" }),
            ev("Assistant", "ok", { turnId: "t2" }),
        ];
        const items = toRenderItems(events);
        // single(User1) → single(Error) → single(User2) → turn(t2)
        // error 在 index 1（两 user 之间），末项是 turn 而非 error——退役 mergeEvents content-match
        expect(items.map((i) => i.kind)).toEqual([
            "single",
            "single",
            "single",
            "turn",
        ]);
        expect(items.at(-1)!.kind).toBe("turn");
        const err = items[1];
        if (err.kind === "single") expect(err.event.type).toBe("Error");
    });

    it("AC-010 Tool 事件带全量 result（reloaded 与 live 一致，无截断）", () => {
        const big = "x".repeat(5000);
        const events: AgentEvent[] = [
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Tool", "read", {
                turnId: "t1",
                data: { name: "read", args: { filePath: "/a" }, result: big },
            }),
        ];
        const items = toRenderItems(events);
        const turn = items[0];
        if (turn.kind === "turn") {
            expect((turn.tools[0].data as { result: string }).result).toBe(big);
        }
    });
});

// bugfix 回归：回合以 Thinking 收尾（停止/出错/无正文 Done）时，终态事件必须
// 闭合思考——否则 ThinkingBlock 把已结束回合当进行中无限计时。
describe("groupByTurn 终态闭合思考（bugfix）", () => {
    it("Thinking 后跟 Stopped → thinkingFinished + endedAt=终态时间戳", () => {
        const turns = groupByTurn([
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Thinking", "hmm", { turnId: "t1", timestamp: 1100 }),
            ev("Stopped", "已停止任务", { timestamp: 5000 }),
        ]);
        expect(turns).toHaveLength(1);
        expect(turns[0].thinkingFinished).toBe(true);
        expect(turns[0].thinkingEndedAt).toBe(5000);
        expect(turns[0].thinkingStartedAt).toBe(1100);
    });

    it("正常回合（Assistant 收尾）endedAt=首个实质事件戳", () => {
        const turns = groupByTurn([
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Thinking", "hmm", { turnId: "t1", timestamp: 1100 }),
            ev("Assistant", "answer", { turnId: "t1", timestamp: 2000 }),
        ]);
        expect(turns[0].thinkingFinished).toBe(true);
        expect(turns[0].thinkingEndedAt).toBe(2000);
    });

    it("toRenderItems：single 切分回合时以自身时间戳闭合开思考（Warning 亦然）", () => {
        const items = toRenderItems([
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Thinking", "hmm", { turnId: "t1", timestamp: 1100 }),
            ev("Warning", "retry", { timestamp: 1500 }),
            ev("Assistant", "answer", { turnId: "t1", timestamp: 2000 }),
            ev("Done", "done", { timestamp: 3000 }),
        ]);
        const turn = items.find((i) => i.kind === "turn");
        if (turn.kind === "turn") {
            expect(turn.thinkingFinished).toBe(true);
            expect(turn.thinkingEndedAt).toBe(1500);
        }
    });

    it("无 opts 时流尾开思考仍保持 open（ThinkingBlock live 门兜底）", () => {
        const turns = groupByTurn([
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Thinking", "hmm", { turnId: "t1" }),
        ]);
        expect(turns[0].thinkingFinished).toBeUndefined();
    });
});
