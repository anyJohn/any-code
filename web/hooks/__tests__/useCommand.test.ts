import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("react-router-dom", () => ({
    useNavigate: () => () => {},
}));

import { useCommand } from "@/hooks/useCommand";

// compact 路由已是 SSE：进度帧 + 结果帧（用户需求 2026-09-05）
function sseResponse(frames: unknown[]): Response {
    const enc = new TextEncoder();
    const body = new ReadableStream({
        start(controller) {
            for (const f of frames) {
                controller.enqueue(
                    enc.encode(`data: ${JSON.stringify(f)}\n\n`)
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

function mkDeps(over: Partial<{
    appendSystem: (m: string) => void;
    submit: (m: string) => void;
    projectKey?: string;
    rootPath: string;
    currentSessionId: string | null;
}> = {}) {
    return {
        appendSystem: vi.fn(),
        submit: vi.fn(),
        projectKey: undefined,
        rootPath: "/w",
        currentSessionId: "s1" as string | null,
        ...over,
    };
}

describe("useCommand /compact (AC-006)", () => {
    beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it("/compact <focus> → POST compact 端点带 focus，SSE 进度+结果帧反馈", async () => {
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockResolvedValue(
            sseResponse([
                { type: "progress", phase: "preparing" },
                { type: "progress", phase: "summarizing", generatedTokens: 3 },
                {
                    type: "result",
                    beforeTokens: 1000,
                    afterTokens: 200,
                    compacted: true,
                },
            ])
        );
        const deps = mkDeps();
        const { result } = renderHook(() => useCommand(deps));
        await act(async () => {
            await result.current.runRawCommand("/compact 聚焦API设计");
        });
        await waitFor(() =>
            expect(deps.appendSystem).toHaveBeenCalledWith(
                expect.stringContaining("1000→200")
            )
        );
        expect(f).toHaveBeenCalledWith(
            "/api/sessions/s1/compact",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ workspacePath: "/w", focus: "聚焦API设计" }),
            })
        );
        // 完成后 compacting 复位
        expect(result.current.compacting).toBe(false);
    });

    it("compacting 进行中 → 为 true（请求未决期间），完成后复位 false", async () => {
        // 手动控制的慢响应：fetch 返回一个待 resolve 的 promise
        let resolveLater: ((r: Response) => void) | undefined;
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockImplementation(
            () =>
                new Promise<Response>((resolve) => {
                    resolveLater = resolve;
                })
        );
        const deps = mkDeps();
        const { result } = renderHook(() => useCommand(deps));
        // runRawCommand 是 fire-and-forget；executeCommand 同步 setCompacting(true) 后 await fetch（未决）
        await act(async () => {
            result.current.runRawCommand("/compact");
        });
        expect(result.current.compacting).toBe(true);
        // resolve fetch → finally setCompacting(false) + appendSystem
        await act(async () => {
            resolveLater?.(
                sseResponse([
                    {
                        type: "result",
                        beforeTokens: 1000,
                        afterTokens: 200,
                        compacted: true,
                    },
                ])
            );
        });
        await waitFor(() => expect(result.current.compacting).toBe(false));
    });

    it("无 currentSessionId（新对话无历史）→ appendSystem 提示无可压缩", async () => {
        const deps = mkDeps({ currentSessionId: null });
        const { result } = renderHook(() => useCommand(deps));
        await act(async () => {
            await result.current.runRawCommand("/compact");
        });
        expect(deps.appendSystem).toHaveBeenCalledWith("无会话历史可压缩");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("compacted=false → appendSystem 提示足够短", async () => {
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockResolvedValue(
            sseResponse([{ type: "result", beforeTokens: 0, afterTokens: 0, compacted: false }])
        );
        const deps = mkDeps();
        const { result } = renderHook(() => useCommand(deps));
        await act(async () => {
            await result.current.runRawCommand("/compact");
        });
        await waitFor(() =>
            expect(deps.appendSystem).toHaveBeenCalledWith(
                expect.stringContaining("足够短")
            )
        );
    });
});
