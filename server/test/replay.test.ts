import { describe, it, expect } from "vitest";
import { replayable } from "../src/routes/sessions.js";
import type { AgentEvent } from "@any-code/domain";

// bugfix 2026-09-10「任务执行中切走再切回，'bash · 执行中'永久卡死」：
// EventStream.history$ 含 transient 影子事件（durable:false），/history 真值只含
// durable 正身。重挂时影子照发 → 正身被 seen 去重跳过 → 孤儿影子驱动
// liveActiveTool 停在 running 态。重放必须按 replayable 过滤：影子仅当位于
// 最后一个 durable 事件之后（当前实时尾段）才下发。

function ev(
    type: AgentEvent["type"],
    opts?: Partial<AgentEvent>
): AgentEvent {
    const base = {
        id: `t-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now(),
        type,
        message: type,
        ...opts,
    };
    // union 各 variant 的 data/error 形状不齐，测试桩只关心 type 分发，经 unknown 断言
    return base as unknown as AgentEvent;
}

describe("replayable —— 重放期影子过滤", () => {
    it("卡死场景：ToolStart+ToolProgress 在 Tool 之前 → 影子全滤掉", () => {
        const history = [
            ev("Iteration"),
            ev("ToolStart", { message: "bash" }),
            ev("ToolProgress"),
            ev("Tool"), // durable 正身：工具已完成
            ev("Assistant"),
        ];
        const keep = replayable(history);
        expect(keep).toEqual([true, false, false, true, true]);
    });

    it("活动尾段：ToolStart 是最后一个 durable 之后 → 照发（恢复执行中卡片）", () => {
        const history = [
            ev("Iteration"),
            ev("Tool"), // 上一个已完成
            ev("ToolStart", { message: "bash" }), // 当前在跑
        ];
        const keep = replayable(history);
        expect(keep).toEqual([true, true, true]);
    });

    it("并行批次：B 的影子在正身 A 落地后 → 滤掉（与前端 live 行为一致，非缺陷）", () => {
        // concurrencySafe 工具（read/grep）并行：StartA、StartB 先发，ToolA 先落地。
        // 前端 liveActiveTool 遇到任何 Tool 就关闭活动卡片（renderItems.ts:332）——
        // live 流里 B 的卡片本来就被 ToolA 关掉了。重放滤掉 StartB 与 live 真值一致：
        // 不会出现"重挂后多出一张 live 期从没有过的卡片"，B 的结果由 durable ToolB 渲染。
        const history = [
            ev("ToolStart", { message: "A" }),
            ev("ToolStart", { message: "B" }), // B 仍在跑（并行）
            ev("Tool", { message: "A" }), // A 先落地
        ];
        const keep = replayable(history);
        expect(keep).toEqual([false, false, true]);
    });

    it("AssistantDelta 幽灵：delta 在定稿 Assistant 之前 → 滤掉（防重挂文本重复）", () => {
        const history = [
            ev("AssistantDelta", { message: "hel" }),
            ev("AssistantDelta", { message: "lo" }),
            ev("Assistant"), // durable 定稿
        ];
        const keep = replayable(history);
        expect(keep).toEqual([false, false, true]);
    });

    it("durable:false 但非影子（System/Interaction/PermissionAsk）→ 不过滤", () => {
        const history = [
            ev("System", { message: "run started" }),
            ev("Interaction", { message: "ask" }),
            ev("PermissionAsk", { message: "perm" }),
        ];
        const keep = replayable(history);
        expect(keep).toEqual([true, true, true]);
    });

    it("无 durable 事件（run 刚起，全是尾段）→ 全部保留", () => {
        const history = [ev("System"), ev("ToolStart", { message: "bash" })];
        const keep = replayable(history);
        expect(keep).toEqual([true, true]);
    });

    it("空 history → 空 keep", () => {
        expect(replayable([])).toEqual([]);
    });

    it("多轮交替：每轮影子随正身落地消散，仅最后一轮尾段存活", () => {
        const history = [
            ev("Iteration"),
            ev("ToolStart", { message: "1" }),
            ev("Tool", { message: "1" }),
            ev("Iteration"),
            ev("ToolStart", { message: "2" }),
            ev("Tool", { message: "2" }),
            ev("ToolStart", { message: "3" }), // 第 3 个工具在跑
        ];
        const keep = replayable(history);
        expect(keep).toEqual([true, false, true, true, false, true, true]);
    });
});
