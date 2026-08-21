import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { AgentEvent } from "@/lib/sseEvents";

// mock useAgent：返回可控状态对象，便于切换空态/typing（目标C 后无 historyLoading，历史由 chat 页预取注入）
const { state } = vi.hoisted(() => ({
    state: {
        events: [] as AgentEvent[],
        pending: false,
        submit: () => {},
        stop: () => {},
    },
}));
vi.mock("@/hooks/useAgent", () => ({
    useAgent: () => state,
}));

import { ChatView } from "@/components/ChatView";

function reset(over: Partial<typeof state>) {
    Object.assign(
        state,
        { events: [], pending: false, submit: () => {}, stop: () => {} },
        over
    );
}

describe("ChatView 空态 + typing indicator", () => {
    it("无事件 → 显示空态文案", () => {
        reset({ events: [] });
        const { queryByText } = render(
            <ChatView sessionId="a1" rootPath="/w" initialEvents={[]} />
        );
        expect(queryByText("发送一条消息开始对话")).not.toBeNull();
    });

    it("pending 且本轮无 Assistant/Tool → 显示 typing indicator（三点）", () => {
        reset({
            pending: true,
            events: [{ id: "u1", timestamp: 1, type: "User", message: "hi" }],
        });
        const { container } = render(
            <ChatView sessionId="a1" rootPath="/w" initialEvents={[]} />
        );
        const dots = container.querySelectorAll(".animate-bounce");
        expect(dots.length).toBe(3);
    });

    it("非 pending → 不显示 typing indicator", () => {
        reset({
            pending: false,
            events: [{ id: "u1", timestamp: 1, type: "User", message: "hi" }],
        });
        const { container } = render(
            <ChatView sessionId="a1" rootPath="/w" initialEvents={[]} />
        );
        expect(container.querySelectorAll(".animate-bounce")).toHaveLength(0);
    });
});
