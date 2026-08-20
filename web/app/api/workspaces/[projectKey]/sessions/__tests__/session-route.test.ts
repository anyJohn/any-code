import { describe, it, expect, vi, beforeEach } from "vitest";

const removeMock = vi.fn(async (_pk: string, _sid: string) => undefined);
const setTitleMock = vi.fn(async (_key: unknown, _title: string) => undefined);

vi.mock("@any-code/domain", () => ({
    SessionService: class {
        remove = (pk: string, sid: string) => removeMock(pk, sid);
        setTitle = (key: unknown, title: string) => setTitleMock(key, title);
    },
}));

import {
    DELETE as sessDelete,
    PATCH as sessPatch,
} from "@/app/api/workspaces/[projectKey]/sessions/[sessionId]/route";

function req(method: string, body?: unknown) {
    return new Request("http://x", {
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json" },
    });
}

function ctx(projectKey: string, sessionId: string) {
    return { params: Promise.resolve({ projectKey, sessionId }) };
}

describe("session [sessionId] route (FE-001)", () => {
    beforeEach(() => {
        removeMock.mockClear();
        setTitleMock.mockClear();
    });

    it("DELETE 调 remove + 返回 removed（幂等，不验证存在）", async () => {
        const r = await sessDelete(req("DELETE"), ctx("pk1", "s1"));
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ status: "removed" });
        expect(removeMock).toHaveBeenCalledWith("pk1", "s1");
    });

    it("PATCH 缺 title → 400", async () => {
        const r = await sessPatch(req("PATCH", {}), ctx("pk1", "s1"));
        expect(r.status).toBe(400);
        expect(setTitleMock).not.toHaveBeenCalled();
    });

    it("PATCH 空 title → 400", async () => {
        const r = await sessPatch(req("PATCH", { title: "   " }), ctx("pk1", "s1"));
        expect(r.status).toBe(400);
    });

    it("PATCH 有 title → renamed + 调 setTitle 传 SessionKey", async () => {
        const r = await sessPatch(
            req("PATCH", { title: "新标题" }),
            ctx("pk1", "s1")
        );
        expect(r.status).toBe(200);
        const body = await r.json();
        expect(body).toEqual({ status: "renamed", title: "新标题" });
        expect(setTitleMock).toHaveBeenCalledWith(
            { projectKey: "pk1", sessionId: "s1" },
            "新标题"
        );
    });

    it("跨项目隔离：路径参数决定 projectKey，不串扰", async () => {
        await sessDelete(req("DELETE"), ctx("P1", "S1"));
        expect(removeMock).toHaveBeenCalledWith("P1", "S1");
        expect(removeMock).not.toHaveBeenCalledWith("P2", "S1");
    });
});
