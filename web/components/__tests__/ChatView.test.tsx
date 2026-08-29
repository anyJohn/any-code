import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { workspaceReducer } from "@/store/workspaceSlice";
import type { AgentEvent } from "@/lib/sseEvents";
import type { ReactNode } from "react";

// mock useAgent：返回可控状态对象，便于切换空态/typing（目标C 后无 historyLoading，历史由 chat 页预取注入）
const { state } = vi.hoisted(() => ({
    state: {
        events: [] as AgentEvent[],
        pending: false,
        currentSessionId: null as string | null,
        submit: () => {},
        stop: () => {},
        clear: () => {},
        appendSystem: () => {},
    },
}));
vi.mock("@/hooks/useAgent", () => ({
    useAgent: () => state,
}));
vi.mock("react-router-dom", () => ({
    useNavigate: () => () => {},
}));

import { ChatView } from "@/components/ChatView";

// ChatView 读 Redux（currentSessionId 转换 → bumpSessions），须包 Provider
const store = configureStore({ reducer: { workspace: workspaceReducer } });
const renderWithStore = (ui: ReactNode) =>
    render(<Provider store={store}>{ui}</Provider>);

function reset(over: Partial<typeof state>) {
    Object.assign(
        state,
        {
            events: [],
            pending: false,
            currentSessionId: null,
            submit: () => {},
            stop: () => {},
            clear: () => {},
            appendSystem: () => {},
        },
        over
    );
}

describe("ChatView 空态 + typing indicator", () => {
    it("无事件 → 显示空态文案", () => {
        reset({ events: [] });
        const { queryByText } = renderWithStore(
            <ChatView sessionId="a1" rootPath="/w" initialEvents={[]} />
        );
        expect(queryByText("发送一条消息开始对话")).not.toBeNull();
    });

    it("pending 且本轮无 Assistant/Tool → 显示 typing indicator（三点）", () => {
        reset({
            pending: true,
            events: [{ id: "u1", timestamp: 1, type: "User", message: "hi" }],
        });
        const { container } = renderWithStore(
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
        const { container } = renderWithStore(
            <ChatView sessionId="a1" rootPath="/w" initialEvents={[]} />
        );
        expect(container.querySelectorAll(".animate-bounce")).toHaveLength(0);
    });
});