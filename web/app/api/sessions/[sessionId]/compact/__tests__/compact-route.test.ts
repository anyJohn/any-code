import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createMock = vi.fn();
const compactMock = vi.fn();
const destroyMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("@any-code/domain", () => ({
    AnyAgent: {
        create: (...args: unknown[]) => {
            createMock(...args);
            return Promise.resolve({
                compact: compactMock,
                getSession: getSessionMock,
                destroy: destroyMock,
            });
        },
    },
}));

import { runningSessions } from "@/lib/singleFlight";
import { POST as compactPost } from "@/app/api/sessions/[sessionId]/compact/route";

function req(body?: unknown) {
    return new Request("http://x", {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json" },
    });
}
const ctx = (sessionId: string) => ({
    params: Promise.resolve({ sessionId }),
});

describe("compact route (AC-004)", () => {
    beforeEach(() => {
        createMock.mockClear();
        compactMock.mockReset();
        destroyMock.mockClear();
        getSessionMock.mockReset();
        getSessionMock.mockReturnValue({ id: "s1" }); // truthy
        runningSessions().clear();
    });
    afterEach(() => runningSessions().clear());

    it("成功：create→compact→destroy，返回压缩结果", async () => {
        compactMock.mockResolvedValue({
            beforeTokens: 1000,
            afterTokens: 200,
            compacted: true,
        });
        const r = await compactPost(
            req({ workspacePath: "/w", focus: "聚焦API" }),
            ctx("s1")
        );
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({
            beforeTokens: 1000,
            afterTokens: 200,
            compacted: true,
        });
        expect(createMock).toHaveBeenCalledWith({
            rootPath: "/w",
            sessionId: "s1",
        });
        expect(compactMock).toHaveBeenCalledWith("聚焦API");
        expect(destroyMock).toHaveBeenCalled();
        // 完成后释放 single-flight
        expect(runningSessions().has("s1")).toBe(false);
    });

    it("无 focus → compact 传 undefined", async () => {
        compactMock.mockResolvedValue({ beforeTokens: 0, afterTokens: 0, compacted: false });
        await compactPost(req({ workspacePath: "/w" }), ctx("s1"));
        expect(compactMock).toHaveBeenCalledWith(undefined);
    });

    it("无 workspacePath → 400，不创建 agent", async () => {
        const r = await compactPost(req({ focus: "x" }), ctx("s1"));
        expect(r.status).toBe(400);
        expect(createMock).not.toHaveBeenCalled();
    });

    it("session 不存在（getSession 假）→ 404 + destroy", async () => {
        getSessionMock.mockReturnValue(null);
        const r = await compactPost(req({ workspacePath: "/w" }), ctx("s1"));
        expect(r.status).toBe(404);
        expect(destroyMock).toHaveBeenCalled();
        expect(compactMock).not.toHaveBeenCalled();
    });

    it("与 /run 互斥：sessionId 已在 running → 409，不创建 agent", async () => {
        runningSessions().add("s1");
        const r = await compactPost(req({ workspacePath: "/w" }), ctx("s1"));
        expect(r.status).toBe(409);
        expect(createMock).not.toHaveBeenCalled();
    });
});
