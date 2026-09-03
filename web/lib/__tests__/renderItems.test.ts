import { describe, it, expect } from "vitest";
import { groupByTurn, toRenderItems } from "@/lib/renderItems";
import type { AgentEvent } from "@/lib/sseEvents";

// AR bugfix 回归：回合以 Thinking 收尾（停止/出错/无正文 Done）时，
// 终态事件必须闭合思考——否则 ThinkingBlock 把已结束回合当进行中无限计时。
const ev = (
    type: AgentEvent["type"],
    message: string,
    timestamp: number,
    turnId?: string
): AgentEvent =>
    ({ id: `${type}-${timestamp}`, timestamp, type, message, ...(turnId ? { turnId } : {}) }) as AgentEvent;

describe("renderItems 终态闭合思考（bugfix）", () => {
    it("Thinking 后跟 Stopped → thinkingFinished + endedAt=终态时间戳", () => {
        const items = groupByTurn([
            ev("Iteration", "Iteration 1/30", 1000, "t1"),
            ev("Thinking", "hmm", 1100, "t1"),
            ev("Thinking", " hmm", 1200, "t1"),
            ev("Stopped", "已停止任务", 5000),
        ]);
        expect(items).toHaveLength(1);
        expect(items[0].thinkingFinished).toBe(true);
        expect(items[0].thinkingEndedAt).toBe(5000);
        expect(items[0].thinkingStartedAt).toBe(1100);
    });

    it("正常回合（Assistant 收尾）不受影响：endedAt=首个实质事件戳", () => {
        const items = groupByTurn([
            ev("Iteration", "Iteration 1/30", 1000, "t1"),
            ev("Thinking", "hmm", 1100, "t1"),
            ev("Assistant", "answer", 2000, "t1"),
        ]);
        expect(items[0].thinkingFinished).toBe(true);
        expect(items[0].thinkingEndedAt).toBe(2000);
    });

    it("toRenderItems：single 事件切分回合时以自身时间戳闭合开思考（Warning 亦然）", () => {
        const items = toRenderItems([
            ev("Iteration", "Iteration 1/30", 1000, "t1"),
            ev("Thinking", "hmm", 1100, "t1"),
            ev("Warning", "retry", 1500),
            ev("Assistant", "answer", 2000, "t1"),
            ev("Done", "完成", 3000),
        ]);
        const turn = items.find((i) => i.kind === "turn") as {
            kind: "turn";
            thinkingFinished?: boolean;
            thinkingEndedAt?: number;
        };
        expect(turn.thinkingFinished).toBe(true);
        expect(turn.thinkingEndedAt).toBe(1500); // Warning 切分回合时闭合
    });
});
