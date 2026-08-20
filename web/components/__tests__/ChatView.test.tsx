import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { AgentEvent } from "@/lib/sseEvents";

// mock useAgent：返回可控状态对象，便于切换三态/typing
const { state } = vi.hoisted(() => ({
    state: {
        events: [] as AgentEvent[],
        pending: false,
        historyLoading: true,
        submit: () => {},
        stop: () => {},
    },
}));
vi.mock("@/hooks/useAgent", () => ({
    useAgent: () => state,
}));

import { ChatView } from "@/components/ChatView";

function reset(over: Partial<typeof state>) {
    Object.assign(state, {
        events: [],
        pending: false,
        historyLoading: false,
        submit: () => {},
        stop: () => {},
    }, over);
}

describe("ChatView 三态 + typing indicator (FE-002)", () => {
    it("historyLoading 且无事件 → 显示骨架（不显示空态文案）", () => {
        reset({ historyLoading: true, events: [] });
        const { container, queryByText } = render(<ChatView agentId="a1" />);
        expect(container.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
        expect(queryByText("发送一条消息开始对话")).toBeNull();
    });

    it("非 loading 且无事件 → 显示空态文案", () => {
        reset({ historyLoading: false, events: [] });
        const { queryByText, container } = render(<ChatView agentId="a1" />);
        expect(queryByText("发送一条消息开始对话")).not.toBeNull();
        expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(0);
    });

    it("pending 且末条为 User → 显示 typing indicator（三点）", () => {
        reset({
            historyLoading: false,
            pending: true,
            events: [{ id: "u1", timestamp: 1, type: "User", message: "hi" }],
        });
        const { container } = render(<ChatView agentId="a1" />);
        const dots = container.querySelectorAll(".animate-bounce");
        expect(dots.length).toBe(3);
    });

    it("非 pending → 不显示 typing indicator", () => {
        reset({
            historyLoading: false,
            pending: false,
            events: [{ id: "u1", timestamp: 1, type: "User", message: "hi" }],
        });
        const { container } = render(<ChatView agentId="a1" />);
        expect(container.querySelectorAll(".animate-bounce")).toHaveLength(0);
    });
});
