/** workspaces 路由（自 index.ts 机械拆分，零逻辑改动）。 */
import {
    Config,
    SessionService,
    WorkspaceRegistry,
    resolveContextWindow,
    resolvePath,
    resolveSkills,
    runRipgrep,
    workspaceConfigDir,
    type SessionKey,
} from "@any-code/domain";
import { resolveWorkspace } from "../shared.js";
import { getAgentManager } from "../agentManager.js";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import type { Hono } from "hono";

export function registerWorkspacesRoutes(app: Hono): void {
    // ==================== workspaces ====================
    // GET /api/workspaces —— 工作区 + 内联 sessions（用户需求 2026-09-05）：
    // 一次返回全部（含运行状态/用量），web 点开工作区零二次请求。会话读取失败 → 空列表降级。
    app.get("/api/workspaces", async (c) => {
        const service = new SessionService();
        const statusById = new Map(
            getAgentManager()
                .statusList()
                .map((s) => [s.sessionId, s])
        );
        const list = await Promise.all(
            WorkspaceRegistry.list().map(async (w) => {
                let sessions: unknown[] = [];
                try {
                    const metas = await service.list(w.projectKey);
                    sessions = metas.map((x) => {
                        const st = statusById.get(x.id);
                        return st
                            ? { ...x, status: st.status, pendingAsk: st.pendingAsk }
                            : x;
                    });
                } catch {
                    // 该工作区会话读取失败 → 空列表，不阻断整体
                }
                return { ...w, sessions };
            })
        );
        return c.json(list);
    });

    app.post("/api/workspaces", async (c) => {
        let body: { path?: string } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const p = body?.path?.trim();
        if (!p) return c.json({ statusMessage: "path required" }, 400);
        try {
            const stat = statSync(p);
            if (!stat.isDirectory()) return c.json({ statusMessage: "not a directory" }, 400);
        } catch (e) {
            return c.json(
                { statusMessage: `path not accessible: ${e instanceof Error ? e.message : ""}` },
                400,
            );
        }
        return c.json(WorkspaceRegistry.add(p));
    });

    app.delete("/api/workspaces", async (c) => {
        let body: { path?: string } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const p = body?.path?.trim();
        if (!p) return c.json({ statusMessage: "path required" }, 400);
        WorkspaceRegistry.remove(p);
        return c.json({ status: "removed" });
    });

    // ---- /api/workspaces/:projectKey/... ----
    app.get("/api/workspaces/:projectKey/status", (c) => {
        const projectKey = c.req.param("projectKey");
        const workspace = resolveWorkspace(projectKey);
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);

        let cfg: Config | null = null;
        try {
            cfg = Config.load();
        } catch {
            return c.json({
                provider: "",
                model: "",
                contextWindow: 128000,
                skillCount: 0,
                skillNames: [],
                mcpServers: [],
            });
        }
        const provider = cfg.getCurrentProvider();
        const mcpServers = Object.entries(cfg.mcpServers).map(([name, s]) => ({
            name,
            type: s.type ?? "",
        }));
        // 技能计数 = resolveSkills 全量（4 层合并 + 目录式 SKILL.md）——原实现只数
        // 项目级平铺 .md，内置 seed（全局目录）全漏 → 恒 0（用户报告 2026-09-06）
        let skillNames: string[] = [];
        try {
            skillNames = [...resolveSkills(workspace).keys()];
        } catch {
            // 解析失败 → 0 个技能
        }
        const currentModel = provider.models.find((m) => m.id === provider.defaultModel);
        return c.json({
            provider: cfg.default,
            model: provider.defaultModel,
            modelName: currentModel?.name ?? provider.defaultModel,
            contextWindow: resolveContextWindow(provider),
            skillCount: skillNames.length,
            skillNames,
            mcpServers,
        });
    });

    // 技能目录（SPEC-037 后续：/skill_name 斜杠指令）——name + description
    app.get("/api/workspaces/:projectKey/skills", (c) => {
        const workspace = resolveWorkspace(c.req.param("projectKey"));
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        try {
            const skills = [...resolveSkills(workspace).values()].map((s) => ({
                name: s.name,
                description: s.description,
                content: s.content,
            }));
            return c.json(skills);
        } catch {
            return c.json([]);
        }
    });

    app.get("/api/workspaces/:projectKey/commands", (c) => {
        const projectKey = c.req.param("projectKey");
        const workspace = resolveWorkspace(projectKey);
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        const dir = join(workspaceConfigDir(workspace), "commands");
        let names: string[] = [];
        try {
            names = readdirSync(dir, { withFileTypes: true })
                .filter((e) => e.isFile() && e.name.endsWith(".md"))
                .map((e) => e.name);
        } catch {
            return c.json([]);
        }
        const commands = names.map((name) => {
            const body = readFileSync(join(dir, name), "utf-8");
            return { name: name.slice(0, -3), body };
        });
        return c.json(commands);
    });

    app.get("/api/workspaces/:projectKey/files", async (c) => {
        const projectKey = c.req.param("projectKey");
        const workspace = resolveWorkspace(projectKey);
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        const q = (c.req.query("q") ?? "").trim().toLowerCase();
        // SPEC-036 B-008 文件 tab：all=1 返回全量（@file 补全仍限 20）；ignored=1
        // 额外列出 gitignore/隐藏文件（rg --no-ignore --hidden）
        const all = c.req.query("all") === "1";
        const ignored = c.req.query("ignored") === "1";
        const args = ["--files"];
        if (ignored) args.push("--no-ignore", "--hidden");
        // 目录不存在（僵尸工作区）/ rg 失败要显式报错——吞掉会让文件 tab 静默显示为空
        if (!existsSync(workspace.rootPath)) {
            return c.json({ statusMessage: `工作区目录不存在：${workspace.rootPath}` }, 400);
        }
        const { stdout, stderr, code } = await runRipgrep(args, { cwd: workspace.rootPath });
        if (code === null || code === 2) {
            return c.json({ statusMessage: stderr.trim() || "ripgrep 执行失败" }, 400);
        }
        const allList = stdout
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            // Windows 上 rg 输出反斜杠路径——统一成 /，前端建树按 / 切分
            .map((p) => p.replace(/\\/g, "/"))
            .map((p) => ({ path: p, name: basename(p) }));
        const out = q
            ? allList
                  .filter(
                      (f) =>
                          f.path.toLowerCase().includes(q) ||
                          f.name.toLowerCase().includes(q),
                  )
                  .slice(0, all ? 2000 : 20)
            : allList.slice(0, all ? 2000 : 20);
        return c.json(out);
    });

    // 工作区文件只读预览（SPEC-036 B-009）：路径守卫 + 大小上限 + 二进制拒显 + 容错解码
    app.get("/api/workspaces/:projectKey/file", (c) => {
        const workspace = resolveWorkspace(c.req.param("projectKey"));
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        const rel = c.req.query("path")?.trim();
        if (!rel) return c.json({ statusMessage: "path required" }, 400);
        // resolvePath 对逃逸路径抛错（路径穿越防护）
        let abs: string;
        try {
            abs = resolvePath(workspace, rel);
        } catch {
            return c.json({ statusMessage: "path escapes workspace" }, 400);
        }
        let stat: import("node:fs").Stats;
        try {
            stat = statSync(abs);
        } catch {
            return c.json({ statusMessage: "file not found" }, 404);
        }
        if (!stat.isFile()) return c.json({ statusMessage: "not a file" }, 400);
        if (stat.size > 1024 * 1024)
            return c.json({ statusMessage: "文件过大（>1MB），不支持预览" }, 400);
        const buf = readFileSync(abs);
        // 二进制判定：首块含 null byte（RelayAgent 同构）
        if (buf.subarray(0, 8000).includes(0))
            return c.json({ statusMessage: "binary file" }, 400);
        const content = buf.toString("utf-8", 0, buf.length); // Node 容错：无效序列替换为 U+FFFD
        return c.json({ path: rel, size: stat.size, content });
    });

    app.get("/api/workspaces/:projectKey/sessions", async (c) => {
        const projectKey = c.req.param("projectKey");
        const service = new SessionService();
        const sessions = await service.list(projectKey);
        // FR-30 B-004：合并运行状态（running/waiting_ask/queued + pending ask 摘要），
        // 供左侧会话列表徽标与跨会话 ask 提醒。
        const statusById = new Map(
            getAgentManager()
                .statusList()
                .filter((s) => s.projectKey === projectKey)
                .map((s) => [s.sessionId, s]),
        );
        return c.json(
            sessions.map((x) => {
                const st = statusById.get(x.id);
                return st
                    ? { ...x, status: st.status, pendingAsk: st.pendingAsk }
                    : x;
            }),
        );
    });

    app.delete("/api/workspaces/:projectKey/sessions/:sessionId", async (c) => {
        const projectKey = c.req.param("projectKey");
        const sessionId = c.req.param("sessionId");
        const service = new SessionService();
        await service.remove(projectKey, sessionId);
        return c.json({ status: "removed" });
    });

    app.patch("/api/workspaces/:projectKey/sessions/:sessionId", async (c) => {
        const projectKey = c.req.param("projectKey");
        const sessionId = c.req.param("sessionId");
        let body: { title?: string } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const title = body?.title?.trim();
        if (!title) return c.json({ statusMessage: "title required" }, 400);
        const key: SessionKey = { projectKey, sessionId };
        const service = new SessionService();
        await service.setTitle(key, title);
        return c.json({ status: "renamed", title });
    });
}
