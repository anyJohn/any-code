/** snapshots 路由（自 index.ts 机械拆分，零逻辑改动）。 */
import {
    SessionService,
    createSnapshotService,
    type AgentEvent,
    type SessionKey,
} from "@any-code/domain";
import { resolveWorkspace } from "../shared.js";
import { runningWorkspaces } from "../singleFlight.js";

import type { Hono } from "hono";

export function registerSnapshotsRoutes(app: Hono): void {
    // ==================== snapshots（AR-4 快照与回滚） ====================
    // 快照存于 ~/.anycode/snapshots/<projectKey>/（shadow-git，项目目录零污染）。
    app.get("/api/workspaces/:projectKey/snapshots", async (c) => {
        const workspace = resolveWorkspace(c.req.param("projectKey"));
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        const svc = createSnapshotService(workspace.rootPath);
        // bugfix（SPEC-036 批 2 发现）：list() 是 async，原同步路由把 Promise 序列化成 {}
        return c.json({ gitAvailable: svc.available(), snapshots: await svc.list() });
    });

    // 工作树相对快照的变更（SPEC-036 B-007 变更 tab）：files(name-status) + patch(统一 diff)
    app.get("/api/workspaces/:projectKey/snapshots/:id/diff", async (c) => {
        const workspace = resolveWorkspace(c.req.param("projectKey"));
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        const svc = createSnapshotService(workspace.rootPath);
        const path = c.req.query("path")?.trim() || undefined;
        try {
            const diff = await svc.diffFrom(c.req.param("id"), path);
            return c.json(diff);
        } catch (e) {
            return c.json(
                { statusMessage: e instanceof Error ? e.message : String(e) },
                400,
            );
        }
    });

    app.post("/api/workspaces/:projectKey/snapshots/rollback", async (c) => {
        const workspace = resolveWorkspace(c.req.param("projectKey"));
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        // AR-4 #6：拒绝与运行中 agent 的竞态（回滚期间 agent 仍在写 → 混合状态树）
        const wsKey = c.req.param("projectKey");
        if (runningWorkspaces().has(wsKey))
            return c.json(
                { statusMessage: "工作区正被运行中的会话使用，请先停止对话再回滚" },
                409,
            );
        let body: { id?: string; sessionId?: string } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const id = body?.id?.trim();
        if (!id) return c.json({ statusMessage: "id required" }, 400);
        try {
            const svc = createSnapshotService(workspace.rootPath);
            await svc.rollbackTo(id);
            // AR-4 #7：回滚审计入会话日志（durable System，回放可见）
            const sid = body?.sessionId?.trim();
            if (sid) {
                try {
                    const key: SessionKey = { projectKey: wsKey, sessionId: sid };
                    await new SessionService().appendEvent(key, {
                        timestamp: Date.now(),
                        type: "System",
                        message: `工作区已回滚到快照 ${id.slice(0, 8)}`,
                    } as AgentEvent);
                } catch {
                    // 审计落盘失败不影响回滚结果
                }
            }
            return c.json({ statusMessage: "rolled back" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    // 单文件回滚（变更 tab 逐文件恢复）：快照后新增的文件删除，其余 checkout 恢复
    app.post("/api/workspaces/:projectKey/snapshots/rollback-file", async (c) => {
        const workspace = resolveWorkspace(c.req.param("projectKey"));
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        const wsKey = c.req.param("projectKey");
        if (runningWorkspaces().has(wsKey))
            return c.json(
                { statusMessage: "工作区正被运行中的会话使用，请先停止对话再回滚" },
                409,
            );
        let body: { id?: string; path?: string; sessionId?: string } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const id = body?.id?.trim();
        const path = body?.path?.trim();
        if (!id || !path) return c.json({ statusMessage: "id and path required" }, 400);
        try {
            const svc = createSnapshotService(workspace.rootPath);
            await svc.rollbackFile(id, path);
            const sid = body?.sessionId?.trim();
            if (sid) {
                try {
                    const key: SessionKey = { projectKey: wsKey, sessionId: sid };
                    await new SessionService().appendEvent(key, {
                        timestamp: Date.now(),
                        type: "System",
                        message: `文件已回滚到快照 ${id.slice(0, 8)}：${path}`,
                    } as AgentEvent);
                } catch {
                    // 审计落盘失败不影响回滚结果
                }
            }
            return c.json({ statusMessage: "rolled back" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });
}
