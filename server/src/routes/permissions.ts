/** permissions 路由（自 index.ts 机械拆分，零逻辑改动）。 */
import {
    loadProjectPermissions,
    saveProjectPermissions,
    type PermissionRule,
} from "@any-code/domain";
import { resolveWorkspace } from "../shared.js";

import type { Hono } from "hono";

export function registerPermissionsRoutes(app: Hono): void {
    // ==================== permissions（SPEC-032 项目级规则） ====================
    // 项目级权限规则：<workspacePath>/.anycode/permissions.yaml（全局段走 /api/config）。
    app.get("/api/workspaces/:projectKey/permissions", (c) => {
        const workspace = resolveWorkspace(c.req.param("projectKey"));
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        try {
            return c.json({ rules: loadProjectPermissions(workspace) });
        } catch (e) {
            // 损坏 fail-safe：返回空规则 + 错误信息（C-003）
            return c.json({ rules: [], statusMessage: (e as Error).message });
        }
    });

    app.put("/api/workspaces/:projectKey/permissions", async (c) => {
        const workspace = resolveWorkspace(c.req.param("projectKey"));
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        let body: { rules?: PermissionRule[] } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const rules = (body.rules ?? []).filter(
            (r) =>
                r &&
                typeof r.tool === "string" &&
                (r.action === "allow" || r.action === "ask" || r.action === "deny"),
        );
        try {
            saveProjectPermissions(workspace, rules);
            return c.json({ statusMessage: "saved" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 500);
        }
    });
}
