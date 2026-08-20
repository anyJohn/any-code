import { describe, it, expect, vi, beforeEach } from "vitest";

// mock agentPool：注入 fake agent（用 vi.hoisted 避免 hoisting 引用未初始化变量）
const { getAgent, createAgent } = vi.hoisted(() => ({
    getAgent: vi.fn(),
    createAgent: vi.fn(),
}));
vi.mock("@/lib/server/agentPool", () => ({
    getAgent,
    createAgent,
    __setAgentForTest: vi.fn(),
}));

import { POST as createAgentRoute } from "@/app/api/agents/route";
import { GET as agentMeta } from "@/app/api/agents/[id]/route";
import { GET as agentHistory } from "@/app/api/agents/[id]/history/route";
import { POST as agentMessages } from "@/app/api/agents/[id]/messages/route";
import { POST as agentStop } from "@/app/api/agents/[id]/stop/route";

function req(url: string, init: { method?: string; body?: unknown } = {}) {
    return new Request(url, {
        method: init.method ?? "GET",
        body: init.body ? JSON.stringify(init.body) : undefined,
        headers: { "content-type": "application/json" },
    });
}

function ctx(id: string) {
    return { params: Promise.resolve({ id }) };
}

describe("agents API (TEST-002)", () => {
    beforeEach(() => {
        getAgent.mockReset();
        createAgent.mockReset();
    });

    it("TC-002 create: 缺 workspacePath → 400", async () => {
        const r = await createAgentRoute(req("http://x/api/agents", { method: "POST", body: {} }));
        expect(r.status).toBe(400);
    });

    it("TC-002 create: 正常 → {id} (B-012 路由 key 是 agentId)", async () => {
        createAgent.mockResolvedValue("agent-xyz");
        const r = await createAgentRoute(
            req("http://x/api/agents", { method: "POST", body: { workspacePath: "/tmp" } })
        );
        expect(r.status).toBe(200);
        const body = await r.json();
        expect(body.id).toBe("agent-xyz");
    });

    it("TC-002.3 meta: 不存在 → 404", async () => {
        getAgent.mockReturnValue(null);
        const r = await agentMeta(req("http://x/api/agents/a1"), ctx("a1"));
        expect(r.status).toBe(404);
    });

    it("TC-002.8 meta: 返回 agentId/workspacePath/projectKey/sessionId", async () => {
        getAgent.mockReturnValue({
            getWorkspace: () => ({ rootPath: "/w" }),
            getProjectKey: () => "pk1",
            getSession: () => ({ id: "s1" }),
        });
        const r = await agentMeta(req("http://x/api/agents/a1"), ctx("a1"));
        const body = await r.json();
        expect(body).toEqual({
            agentId: "a1",
            workspacePath: "/w",
            projectKey: "pk1",
            sessionId: "s1",
        });
    });

    it("TC-002.8 history: session 为 null → 空数组（新建对话不报错, B-016）", async () => {
        getAgent.mockReturnValue({ getSession: () => null });
        const r = await agentHistory(req("http://x/api/agents/a1"), ctx("a1"));
        expect(await r.json()).toEqual([]);
    });

    it("TC-002.6 messages: 立即 accepted，agent.submit 被调（B-010）", async () => {
        const submit = vi.fn();
        getAgent.mockReturnValue({ submit });
        const r = await agentMessages(
            req("http://x/api/agents/a1", { method: "POST", body: { task: "hi" } }),
            ctx("a1")
        );
        expect(r.status).toBe(200);
        expect((await r.json()).status).toBe("accepted");
        expect(submit).toHaveBeenCalledWith("hi");
    });

    it("TC-002.4 messages: 空 task → 400", async () => {
        getAgent.mockReturnValue({ submit: vi.fn() });
        const r = await agentMessages(
            req("http://x/api/agents/a1", { method: "POST", body: { task: "  " } }),
            ctx("a1")
        );
        expect(r.status).toBe(400);
    });

    it("TC-002.7 stop: 触发 agent.stop（B-011）", async () => {
        const stop = vi.fn();
        getAgent.mockReturnValue({ stop });
        const r = await agentStop(req("http://x/api/agents/a1", { method: "POST" }), ctx("a1"));
        expect((await r.json()).status).toBe("stopped");
        expect(stop).toHaveBeenCalledOnce();
    });
});
