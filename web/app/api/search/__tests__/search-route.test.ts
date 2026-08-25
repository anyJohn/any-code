import { describe, it, expect, vi, beforeEach } from "vitest";

const listWorkspaces = vi.fn();
const listSessions = vi.fn();

vi.mock("@any-code/domain", () => ({
    WorkspaceRegistry: { list: (...a: unknown[]) => listWorkspaces(...a) },
    SessionService: class {
        list = (pk: string) => listSessions(pk);
    },
}));

import { GET as searchGet } from "@/app/api/search/route";

function mkReq(q: string) {
    return new Request("http://x/api/search" + (q ? `?q=${encodeURIComponent(q)}` : ""));
}

const ws = (name: string, projectKey: string, rootPath = "/r/" + name) => ({
    name,
    projectKey,
    rootPath,
    addedAt: 1,
    lastUsedAt: 2,
});
const sess = (id: string, title: string, updatedAt = 0) => ({
    id,
    title,
    createdAt: 0,
    updatedAt,
});

describe("search route", () => {
    beforeEach(() => {
        listWorkspaces.mockReset();
        listSessions.mockReset();
    });

    it("空 q → 空结果", async () => {
        const r = await searchGet(mkReq(""));
        expect(r.status).toBe(200);
        const j = (await r.json()) as { sessions: unknown[]; workspaces: unknown[] };
        expect(j.sessions).toEqual([]);
        expect(j.workspaces).toEqual([]);
        expect(listWorkspaces).not.toHaveBeenCalled();
    });

    it("工作区 name 命中（大小写不敏感）", async () => {
        listWorkspaces.mockReturnValue([ws("Any-Code", "pk1"), ws("Demo", "pk2")]);
        listSessions.mockResolvedValue([]);
        const r = await searchGet(mkReq("any"));
        const j = (await r.json()) as { workspaces: { name: string }[] };
        expect(j.workspaces).toHaveLength(1);
        expect(j.workspaces[0].name).toBe("Any-Code");
    });

    it("session title 命中 + 带 projectKey/workspaceName", async () => {
        listWorkspaces.mockReturnValue([ws("Any-Code", "pk1")]);
        listSessions.mockResolvedValue([
            sess("s1", "Refactor auth"),
            sess("s2", "unrelated"),
        ]);
        const r = await searchGet(mkReq("auth"));
        const j = (await r.json()) as {
            sessions: {
                projectKey: string;
                sessionId: string;
                title: string;
                workspaceName: string;
            }[];
        };
        expect(j.sessions).toHaveLength(1);
        expect(j.sessions[0]).toMatchObject({
            projectKey: "pk1",
            sessionId: "s1",
            title: "Refactor auth",
            workspaceName: "Any-Code",
        });
    });

    it("session 按 updatedAt 倒序", async () => {
        listWorkspaces.mockReturnValue([ws("W", "pk")]);
        listSessions.mockResolvedValue([
            sess("old", "match a", 100),
            sess("new", "match b", 500),
        ]);
        const r = await searchGet(mkReq("match"));
        const j = (await r.json()) as { sessions: { sessionId: string }[] };
        expect(j.sessions.map((s) => s.sessionId)).toEqual(["new", "old"]);
    });

    it("某工作区 list 抛错不阻断其他工作区", async () => {
        listWorkspaces.mockReturnValue([ws("A", "pkA"), ws("B", "pkB")]);
        listSessions.mockImplementation(async (pk: string) => {
            if (pk === "pkA") throw new Error("disk");
            return [sess("sb", "hit", 1)];
        });
        const r = await searchGet(mkReq("hit"));
        const j = (await r.json()) as { sessions: { sessionId: string }[] };
        expect(j.sessions).toHaveLength(1);
        expect(j.sessions[0].sessionId).toBe("sb");
    });
});
