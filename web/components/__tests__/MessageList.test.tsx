import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageList } from "@/components/MessageList";
import { toRenderItems } from "@/lib/renderItems";
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

const baseProps = (events: AgentEvent[], pending: boolean) => ({
    renderItems: toRenderItems(events),
    events,
    pending,
    openTools: {},
    openSubs: {},
    toggleTool: () => {},
    toggleSub: () => {},
    scrollRef: { current: null },
    onLayoutEffect: () => {},
});

describe("MessageList 活动工具卡片（SPEC-018 AC-003）", () => {
    it("ToolStart 未关闭 → 渲染执行中卡片 + 累积 progress", () => {
        const events: AgentEvent[] = [
            ev("User", "run it"),
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Assistant", "let me run", { turnId: "t1" }),
            ev("ToolStart", "bash", { turnId: "t1", data: { name: "bash" } }),
            ev("ToolProgress", "line1\n", { turnId: "t1" }),
            ev("ToolProgress", "line2\n", { turnId: "t1" }),
        ];
        const { container } = render(
            <MessageList {...baseProps(events, true)} />
        );
        expect(screen.getByText(/执行中/)).toBeTruthy();
        expect(screen.getByText("bash · 执行中")).toBeTruthy();
        expect(screen.getByText(/line1/)).toBeTruthy();
        expect(screen.getByText(/line2/)).toBeTruthy();
        // typing dots 不显示（已有工具反馈）
        expect(container.querySelectorAll(".animate-bounce")).toHaveLength(0);
    });

    it("ToolStart 已被 Tool 关闭 → 不渲染执行中卡片", () => {
        const events: AgentEvent[] = [
            ev("ToolStart", "bash", { turnId: "t1" }),
            ev("ToolProgress", "x", { turnId: "t1" }),
            ev("Tool", "bash", {
                turnId: "t1",
                data: { name: "bash", args: {}, result: "done" },
            }),
        ];
        render(<MessageList {...baseProps(events, true)} />);
        expect(screen.queryByText(/执行中/)).toBeNull();
    });
});

describe("MessageList typing（SPEC-018 AC-004）", () => {
    it("pending + 仅 Iteration（无输出）→ 显示 typing dots", () => {
        const events: AgentEvent[] = [
            ev("User", "hi"),
            ev("Iteration", "i1", { turnId: "t1" }),
        ];
        const { container } = render(
            <MessageList {...baseProps(events, true)} />
        );
        expect(container.querySelectorAll(".animate-bounce")).toHaveLength(3);
    });

    it("ToolStart 到达 → typing dots 隐藏（输出已开始）", () => {
        const events: AgentEvent[] = [
            ev("User", "hi"),
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("ToolStart", "bash", { turnId: "t1" }),
        ];
        const { container } = render(
            <MessageList {...baseProps(events, true)} />
        );
        expect(container.querySelectorAll(".animate-bounce")).toHaveLength(0);
    });

    it("Assistant 到达 → typing dots 隐藏", () => {
        const events: AgentEvent[] = [
            ev("User", "hi"),
            ev("Iteration", "i1", { turnId: "t1" }),
            ev("Assistant", "answer", { turnId: "t1" }),
        ];
        const { container } = render(
            <MessageList {...baseProps(events, true)} />
        );
        expect(container.querySelectorAll(".animate-bounce")).toHaveLength(0);
    });
});
