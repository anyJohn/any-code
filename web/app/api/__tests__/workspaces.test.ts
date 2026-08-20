import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const listMock = vi.fn(() => [{ name: "w1", projectKey: "pk1", rootPath: "/w" }]);
const addMock = vi.fn((p: string) => ({ name: "added", projectKey: "pk-" + p, rootPath: p }));
const removeMock = vi.fn((p: string) => undefined);
const sessionsListMock = vi.fn(async (_pk: string) => [{ id: "s1", title: "t1" }]);

vi.mock("@any-code/domain", () => ({
    WorkspaceRegistry: {
        list: () => listMock(),
        add: (p: string) => addMock(p),
        remove: (p: string) => removeMock(p),
    },
    SessionService: class {
        list = (pk: string) => sessionsListMock(pk);
    },
}));

import { GET as wsList, POST as wsAdd, DELETE as wsRemove } from "@/app/api/workspaces/route";
import { GET as wsSessions } from "@/app/api/workspaces/[projectKey]/sessions/route";

function jreq(method: string, body?: unknown) {
    return new Request("http://x/api/workspaces", {
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json" },
    });
}

describe("workspaces + sessions API (TEST-002)", () => {
    beforeEach(() => {
        listMock.mockClear();
        addMock.mockClear();
        removeMock.mockClear();
        sessionsListMock.mockClear();
    });

    it("GET list 返回注册表", async () => {
        const r = await wsList();
        expect(await r.json()).toEqual([{ name: "w1", projectKey: "pk1", rootPath: "/w" }]);
    });

    it("POST add 缺 path → 400", async () => {
        expect((await wsAdd(jreq("POST", {}))).status).toBe(400);
    });

    it("POST add 非目录 → 400", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-ws-"));
        const file = path.join(tmp, "f");
        fs.writeFileSync(file, "x");
        expect((await wsAdd(jreq("POST", { path: file }))).status).toBe(400);
        fs.rmSync(tmp, { recursive: true });
    });

    it("POST add 真目录 → 200 且调 add", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-ws2-"));
        const r = await wsAdd(jreq("POST", { path: tmp }));
        expect(r.status).toBe(200);
        expect(addMock).toHaveBeenCalledWith(tmp);
        fs.rmSync(tmp, { recursive: true });
    });

    it("DELETE remove 缺 path → 400", async () => {
        expect((await wsRemove(jreq("DELETE", {}))).status).toBe(400);
    });

    it("DELETE remove 有 path → removed", async () => {
        const r = await wsRemove(jreq("DELETE", { path: "/w" }));
        expect((await r.json()).status).toBe("removed");
        expect(removeMock).toHaveBeenCalledWith("/w");
    });

    it("GET sessions 返回 list", async () => {
        const r = await wsSessions(new Request("http://x/api/workspaces/pk1/sessions"), {
            params: Promise.resolve({ projectKey: "pk1" }),
        });
        expect(await r.json()).toEqual([{ id: "s1", title: "t1" }]);
        expect(sessionsListMock).toHaveBeenCalledWith("pk1");
    });
});
