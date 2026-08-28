import { describe, it, expect } from "vitest";
import { createApp } from "../src/index.js";

// AC-008（server 可作为库 import + app.request 跑路由）+ SPEC-028 AC-002 子集。
// 这些 GET/400 都只读 domain 的 ~/.anycode（config/workspaces/session 查找），无副作用。

describe("@any-code/server routes", () => {
    const app = createApp(); // 无 staticDir → API only

    it("createApp 返回 Hono app（AC-008：可作为库 import，桌面端可 spawn）", () => {
        expect(app).toBeDefined();
        expect(typeof app.request).toBe("function");
    });

    it("GET /api/config → 200 + providers（domain Config 集成）", async () => {
        const res = await app.request("/api/config");
        expect(res.status).toBe(200);
        const json = (await res.json()) as { providers: unknown };
        expect(json).toHaveProperty("providers");
    });

    it("GET /api/workspaces → 200 + 数组", async () => {
        const res = await app.request("/api/workspaces");
        expect(res.status).toBe(200);
        expect(Array.isArray(await res.json())).toBe(true);
    });

    it("GET /api/sessions/none/history → 404（不存在的 session）", async () => {
        const res = await app.request("/api/sessions/none/history");
        expect(res.status).toBe(404);
    });

    it("POST /api/sessions 缺 workspacePath → 400（参数校验）", async () => {
        const res = await app.request("/api/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
        });
        expect(res.status).toBe(400);
    });

    it("GET /api/fs/browse?dir=/tmp → 200 + current", async () => {
        const res = await app.request("/api/fs/browse?dir=/tmp");
        expect(res.status).toBe(200);
        const json = (await res.json()) as { current: string; dirs: unknown[] };
        expect(json.current).toBe("/tmp");
        expect(Array.isArray(json.dirs)).toBe(true);
    });

    it("GET /api/search?q=zzznomatch → 200 + 空 sessions/workspaces", async () => {
        const res = await app.request("/api/search?q=zzznomatchxyz");
        expect(res.status).toBe(200);
        const json = (await res.json()) as { sessions: unknown[]; workspaces: unknown[] };
        expect(json.sessions).toEqual([]);
    });
});
