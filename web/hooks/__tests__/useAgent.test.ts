import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgent } from "@/hooks/useAgent";

// 假 EventSource：暴露 push 方法用于测试注入帧
class FakeES {
    url: string;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    static last: FakeES | null = null;
    constructor(url: string) {
        this.url = url;
        (FakeES.last as FakeES | null) = this;
    }
    close = vi.fn(() => {
        (FakeES.last as FakeEventSource | null) = null;
    });
    push(e: unknown) {
        this.onmessage?.({ data: JSON.stringify(e) });
    }
}
type FakeEventSource = typeof FakeES;

describe("useAgent (TEST-005 TC-005.6/.7, B-004/B-011)", () => {
    beforeEach(() => {
        vi.stubGlobal("EventSource", FakeES);
        vi.stubGlobal("fetch", vi.fn());
        FakeES.last = null;
    });
    afterEach(() => vi.unstubAllGlobals());

    function setup(history: unknown[] = [], eventsOk = true) {
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        // loadHistory: GET /history ; submit: POST /messages
        f.mockImplementation(async (url: string, init?: RequestInit) => {
            if (typeof url === "string" && url.endsWith("/history")) {
                return { ok: eventsOk, json: async () => history };
            }
            return { ok: true, json: async () => ({ status: "accepted" }) } as any;
        });
    }

    it("TC-005.6 乐观插入用户气泡 + pending=true（B-004）", async () => {
        setup([]);
        const { result } = renderHook(() => useAgent("a1"));
        // 等 loadHistory + connect
        await act(() => Promise.resolve());
        await act(() => Promise.resolve());

        act(() => result.current.submit("hi"));
        const events = result.current.events;
        // 立即出现本地 User 气泡
        expect(events.some((e) => e.type === "User" && e.message === "hi")).toBe(true);
        expect(result.current.pending).toBe(true);
    });

    it("TC-005.7 Done 解除 pending（B-011）", async () => {
        setup([]);
        const { result } = renderHook(() => useAgent("a1"));
        await act(() => Promise.resolve());
        await act(() => Promise.resolve());

        act(() => result.current.submit("hi"));
        expect(result.current.pending).toBe(true);

        // SSE 推 Done
        act(() => FakeES.last?.push({ type: "Done", message: "done" }));
        expect(result.current.pending).toBe(false);
    });

    it("TC-005.7 Error 与 Stopped 也解除 pending（B-011）", async () => {
        setup([]);
        const { result } = renderHook(() => useAgent("a1"));
        await act(() => Promise.resolve());
        await act(() => Promise.resolve());

        act(() => result.current.submit("hi"));
        act(() => FakeES.last?.push({ type: "Error", message: "err" }));
        expect(result.current.pending).toBe(false);

        act(() => result.current.submit("again"));
        act(() => FakeES.last?.push({ type: "Stopped", message: "stopped" }));
        expect(result.current.pending).toBe(false);
    });

    it("TC-005.2 历史回放：messagesToEvents 注入为事件（B-002）", async () => {
        setup([
            { role: "user", content: "hist-user" },
            { role: "assistant", content: "hist-assistant" },
        ]);
        const { result } = renderHook(() => useAgent("a1"));
        await act(() => Promise.resolve());
        await act(() => Promise.resolve());
        const types = result.current.events.map((e) => e.type);
        expect(types).toContain("User");
        expect(types).toContain("Assistant");
    });

    it("historyLoading 初始 true，历史加载完转 false", async () => {
        setup([]);
        const { result } = renderHook(() => useAgent("a1"));
        expect(result.current.historyLoading).toBe(true);
        await act(() => Promise.resolve());
        await act(() => Promise.resolve());
        expect(result.current.historyLoading).toBe(false);
    });

    it("history 加载失败也解除 historyLoading", async () => {
        // fetch /history 返回 !ok
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockImplementation(async (url: string) => {
            if (typeof url === "string" && url.endsWith("/history")) {
                return { ok: false, json: async () => [] };
            }
            return { ok: true, json: async () => ({ status: "accepted" }) } as any;
        });
        const { result } = renderHook(() => useAgent("a1"));
        await act(() => Promise.resolve());
        await act(() => Promise.resolve());
        expect(result.current.historyLoading).toBe(false);
    });

    it("卸载时关闭 EventSource", async () => {
        setup([]);
        const { unmount } = renderHook(() => useAgent("a1"));
        await act(() => Promise.resolve());
        await act(() => Promise.resolve());
        const es = FakeES.last;
        expect(es).not.toBeNull();
        unmount();
        expect(es!.close).toHaveBeenCalled();
    });
});
