/** jobs 路由（自 index.ts 机械拆分，零逻辑改动）。 */
import {
    Config,
    bashCandidates,
} from "@any-code/domain";
import { getWorkspaceJobs, resolveWorkspace, workspaceJobs } from "../shared.js";

import type { Hono } from "hono";

export function registerJobsRoutes(app: Hono): void {
    // ==================== jobs (SPEC-038) ====================
    app.get("/api/workspaces/:projectKey/jobs", (c) => {
        const projectKey = c.req.param("projectKey");
        const registry = workspaceJobs.get(projectKey);
        if (!registry) return c.json([]);
        return c.json(registry.list());
    });

    // 手动创建后台任务（用户 todo）：Runtime tab「新建进程」——与 agent 起的进程同注册表
    app.post("/api/workspaces/:projectKey/jobs", async (c) => {
        const projectKey = c.req.param("projectKey");
        const workspace = resolveWorkspace(projectKey);
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        let body: { command?: string };
        try {
            body = (await c.req.json()) as { command?: string };
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const command = body.command?.trim();
        if (!command) return c.json({ statusMessage: "command required" }, 400);
        const binary = bashCandidates(Config.load().gitBashPath)[0];
        if (!binary)
            return c.json(
                { statusMessage: "无可用 bash（Windows 需安装 Git for Windows）" },
                400
            );
        const registry = getWorkspaceJobs(projectKey);
        const id = registry.launch(binary, ["-c", command], workspace.rootPath, "手动任务");
        return c.json({ id });
    });

    app.post("/api/workspaces/:projectKey/jobs/:jobId/kill", (c) => {
        const registry = workspaceJobs.get(c.req.param("projectKey"));
        if (!registry) return c.json({ statusMessage: "job not found" }, 404);
        const ok = registry.kill(c.req.param("jobId"));
        if (!ok) return c.json({ statusMessage: "job not found" }, 404);
        return c.json({ statusMessage: "killed" });
    });
}
