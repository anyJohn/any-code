import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAgent } from "@/hooks/useAgent";
import type { AgentEvent } from "@/lib/sseEvents";

// 构造一个 SSE 流响应：body 发若干 `data: {json}\n\n` 帧后关闭
function sseResponse(events: Array<Omit<AgentEvent, "id">>): Response {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const e of events) {
                controller.enqueue(
                    enc.encode(`data: ${JSON.stringify(e)}\n\n`)
                );
            }
            controller.close();
        },
    });
    return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
    });
}

function jsonResponse(obj: unknown, status = 200): Response {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { "content-type": "application/json" },
    });
}

describe("useAgent (目标C: fetch-stream + 两步建 session)", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
        // jsdom 没有 window.history.replaceState 的真实路由，但方法存在； stub 防 console 噪音
        vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    });
    afterEach(() => vi.unstubAllGlobals());

    it("initialEvents 注入历史", () => {
        const { result } = renderHook(() =>
            useAgent("s1", "/w", [
                { id: "h1", timestamp: 1, type: "Assistant", message: "hist" },
            ])
        );
        expect(result.current.events.length).toBe(1);
        expect(result.current.events[0].message).toBe("hist");
    });

    it("submit 流式接收事件 + Done 解除 pending（含乐观 User 气泡）", async () => {
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockResolvedValue(
            sseResponse([
                { timestamp: 1, type: "Iteration", message: "i1", turnId: "t1" },
                { timestamp: 2, type: "Done", message: "完成" },
            ])
        );
        const { result } = renderHook(() => useAgent("s1", "/w", []));
        await act(async () => {
            result.current.submit("hi");
        });
        await waitFor(() => expect(result.current.pending).toBe(false));
        const types = result.current.events.map((e) => e.type);
        expect(types).toContain("User"); // 乐观插入
        expect(types).toContain("Iteration");
        expect(types).toContain("Done");
        // /run 调用带 task + workspacePath
        expect(f).toHaveBeenCalledWith(
            "/api/sessions/s1/run",
            expect.objectContaining({ method: "POST" })
        );
    });

    it("新对话 submit：先 POST /api/sessions 建 session，再 /run", async () => {
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockImplementation(async (url: string) => {
            if (url === "/api/sessions")
                return jsonResponse({ sessionId: "new-sid", projectKey: "pk" }, 201);
            return sseResponse([{ timestamp: 1, type: "Done", message: "ok" }]);
        });
        const { result } = renderHook(() => useAgent(null, "/w", []));
        await act(async () => {
            result.current.submit("first");
        });
        await waitFor(() => expect(result.current.pending).toBe(false));
        expect(f).toHaveBeenCalledWith("/api/sessions", expect.any(Object));
        expect(f).toHaveBeenCalledWith(
            "/api/sessions/new-sid/run",
            expect.any(Object)
        );
        expect(
            result.current.events.some((e) => e.type === "Done")
        ).toBe(true);
    });

    it("stop aborts the run fetch（关页面=停）", async () => {
        let captured: AbortSignal | undefined;
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockImplementation(async (_url: string, init?: RequestInit) => {
            captured = init?.signal ?? undefined;
            // 永不关闭的流，模拟任务在跑
            return new Response(new ReadableStream({ start() {} }), {
                status: 200,
            });
        });
        const { result } = renderHook(() => useAgent("s1", "/w", []));
        act(() => {
            result.current.submit("hi");
        });
        await waitFor(() => expect(captured).toBeTruthy());
        act(() => result.current.stop());
        expect(captured?.aborted).toBe(true);
    });
});
