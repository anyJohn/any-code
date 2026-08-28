import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, join, parse as parsePath, resolve } from "node:path";
import os from "node:os";
import {
    AnyAgent,
    Config,
    createWorkspace,
    maskApiKey,
    projectKeyOf,
    resolveContextWindow,
    resolveInteraction,
    runRipgrep,
    SessionService,
    type ConfigShape,
    type SessionKey,
    type Workspace,
    WorkspaceRegistry,
    workspaceConfigDir,
} from "@any-code/domain";
import { runningSessions } from "./singleFlight.js";

/**
 * AnyCode HTTP server (hono) —— 静态 SPA 的薄 driving adapter。
 * 只依赖 @any-code/domain，无业务逻辑；14 个 API 端点从 Next route.ts 迁来
 * （NextResponse.json → c.json；req.json → c.req.json；SSE Response(ReadableStream) 原样）。
 * 见 DEC-007 / SPEC-028。
 */
const TERMINAL = new Set(["Done", "Error", "Stopped"]);

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".map": "application/json",
};

/** 安全读静态文件 + SPA fallback（非 /api 的 GET 落回 index.html）。 */
function staticOrSpa(c: Context, staticDir: string): Response {
    const url = new URL(c.req.url);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("/api/")) return c.text("not found", 404);
    const rel = pathname === "/" ? "/index.html" : pathname;
    // 防路径穿越：解析后必须仍在 staticDir 下
    const fp = resolve(staticDir, "." + rel);
    if (!fp.startsWith(resolve(staticDir))) return c.text("forbidden", 403);
    try {
        const st = statSync(fp);
        if (st.isFile()) {
            const ext = fp.slice(fp.lastIndexOf("."));
            return c.body(readFileSync(fp), 200, {
                "Content-Type": MIME[ext] ?? "application/octet-stream",
            }) as Response;
        }
    } catch {
        // 文件不存在 → 走 SPA fallback
    }
    const idx = join(staticDir, "index.html");
    if (existsSync(idx)) {
        return c.body(readFileSync(idx, "utf8"), 200, {
            "Content-Type": "text/html; charset=utf-8",
        }) as Response;
    }
    return c.text("not found", 404);
}

function resolveWorkspace(projectKey: string): Workspace | null {
    const meta = WorkspaceRegistry.list().find((w) => w.projectKey === projectKey);
    return meta ? createWorkspace(meta.rootPath) : null;
}

export function createApp(opts: { staticDir?: string } = {}): Hono {
    const app = new Hono();

    // ==================== workspaces ====================
    app.get("/api/workspaces", (c) => c.json(WorkspaceRegistry.list()));

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
        const skillsDir = join(workspaceConfigDir(workspace), "skills");
        let skillNames: string[] = [];
        try {
            const entries = readdirSync(skillsDir, { withFileTypes: true });
            skillNames = entries
                .filter((e) => e.isFile() && e.name.endsWith(".md"))
                .map((e) => e.name.slice(0, -3));
        } catch {
            // 目录不存在 → 0 个技能
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
        const { stdout } = await runRipgrep(["--files"], { cwd: workspace.rootPath });
        const all = stdout
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((p) => ({ path: p, name: basename(p) }));
        const out = q
            ? all
                  .filter(
                      (f) =>
                          f.path.toLowerCase().includes(q) ||
                          f.name.toLowerCase().includes(q),
                  )
                  .slice(0, 20)
            : all.slice(0, 20);
        return c.json(out);
    });

    app.get("/api/workspaces/:projectKey/sessions", async (c) => {
        const projectKey = c.req.param("projectKey");
        const service = new SessionService();
        return c.json(await service.list(projectKey));
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

    // ==================== sessions ====================
    app.post("/api/sessions", async (c) => {
        let body: { workspacePath?: string } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const workspacePath = body?.workspacePath?.trim();
        if (!workspacePath) return c.json({ statusMessage: "workspacePath required" }, 400);
        const projectKey = projectKeyOf(workspacePath);
        const service = new SessionService();
        const session = await service.create(projectKey, "New Session");
        return c.json({ sessionId: session.id, projectKey }, 201);
    });

    // POST /api/sessions/:sessionId/run —— SSE 流式（连接持有：终态/断开=destroy）
    app.post("/api/sessions/:sessionId/run", async (c) => {
        const sessionId = c.req.param("sessionId");
        let body: { task?: string; workspacePath?: string } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const task = body?.task?.trim();
        const workspacePath = body?.workspacePath?.trim();
        if (!task) return c.json({ statusMessage: "task required" }, 400);
        if (!workspacePath) return c.json({ statusMessage: "workspacePath required" }, 400);

        const running = runningSessions();
        if (running.has(sessionId))
            return c.json({ statusMessage: "session already running" }, 409);
        running.add(sessionId);

        const agent = await AnyAgent.create({ rootPath: workspacePath, sessionId });
        if (!agent.getSession()) {
            running.delete(sessionId);
            agent.destroy();
            return c.json({ statusMessage: "session not found" }, 404);
        }

        const headers = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        };

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const enc = new TextEncoder();
                let sub: { unsubscribe: () => void } | null = null;
                let closed = false;

                const send = (e: unknown) => {
                    if (closed) return;
                    try {
                        // Error 对象的 message/stack/name 不可枚举，JSON.stringify(err) = {}；
                        // replacer 在序列化边界提取，让 interface 层拿到完整错误结构体。
                        controller.enqueue(
                            enc.encode(
                                `data: ${JSON.stringify(e, (_k, v) => {
                                    if (v instanceof Error) {
                                        return {
                                            message: v.message,
                                            name: v.name,
                                            stack: v.stack,
                                            ...(v.cause ? { cause: String(v.cause) } : {}),
                                        };
                                    }
                                    return v;
                                })}\n\n`,
                            ),
                        );
                    } catch {
                        // controller 已关
                    }
                };
                const finish = () => {
                    if (closed) return;
                    closed = true;
                    clearInterval(keepalive);
                    sub?.unsubscribe();
                    running.delete(sessionId);
                    agent.destroy(); // 关连接=destroy=abort 在途 LLM + 拆订阅
                    try {
                        controller.close();
                    } catch {
                        // 已关
                    }
                };

                // SSE keepalive：静默期每 15s 注入 comment frame，防 proxy/浏览器断连
                const keepalive = setInterval(() => {
                    if (closed) return;
                    try {
                        controller.enqueue(enc.encode(": keepalive\n\n"));
                    } catch {
                        // controller 已关
                    }
                }, 15000);

                for (const e of agent.eventHistory$.value) send(e);
                sub = agent.eventStream$.subscribe((e: { type?: string }) => {
                    send(e);
                    if (e?.type && TERMINAL.has(e.type)) finish();
                });
                // 客户端断开（关页面/abort）→ finish → destroy → 真停
                c.req.raw.signal.addEventListener("abort", finish, { once: true });
                agent.submit(task);
            },
        });

        return new Response(stream, { headers });
    });

    app.post("/api/sessions/:sessionId/compact", async (c) => {
        const sessionId = c.req.param("sessionId");
        let body: { focus?: string; workspacePath?: string } = {};
        try {
            body = await c.req.json();
        } catch {
            // 空 body 允许
        }
        const workspacePath = body?.workspacePath?.trim();
        if (!workspacePath) return c.json({ statusMessage: "workspacePath required" }, 400);

        const running = runningSessions();
        if (running.has(sessionId))
            return c.json({ statusMessage: "session is running" }, 409);
        running.add(sessionId);
        try {
            const agent = await AnyAgent.create({ rootPath: workspacePath, sessionId });
            if (!agent.getSession()) {
                agent.destroy();
                return c.json({ statusMessage: "session not found" }, 404);
            }
            const focus = body?.focus?.trim() || undefined;
            const res = await agent.compact(focus);
            agent.destroy();
            return c.json(res);
        } catch (err) {
            return c.json(
                {
                    statusMessage: "compact failed",
                    error: err instanceof Error ? err.message : String(err),
                },
                500,
            );
        } finally {
            running.delete(sessionId);
        }
    });

    app.get("/api/sessions/:sessionId/history", async (c) => {
        const sessionId = c.req.param("sessionId");
        const service = new SessionService();
        const found = await service.findSession(sessionId);
        if (!found) return c.json({ statusMessage: "session not found" }, 404);
        return c.json({
            messages: found.session.messages,
            projectKey: found.key.projectKey,
        });
    });

    app.post("/api/sessions/:sessionId/interact", async (c) => {
        let body: { interactionId?: string; answers?: string[] } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const id = body?.interactionId?.trim();
        const answers = body?.answers;
        if (!id || !Array.isArray(answers))
            return c.json({ statusMessage: "interactionId and answers[] required" }, 400);
        const ok = resolveInteraction(id, answers);
        if (!ok)
            return c.json(
                { statusMessage: "interaction not found (timed out, aborted, or already answered)" },
                404,
            );
        return c.json({ status: "answered" });
    });

    // ==================== config ====================
    app.get("/api/config", (c) => {
        try {
            const cfg = Config.load();
            const providers: Record<string, unknown> = {};
            for (const [name, p] of Object.entries(cfg.providers)) {
                providers[name] = { ...p, apiKey: maskApiKey(p.apiKey) };
            }
            return c.json({ providers, default: cfg.default, mcp: cfg.mcpServers });
        } catch {
            return c.json({ providers: {}, default: undefined, mcp: {} });
        }
    });

    app.post("/api/config", async (c) => {
        let body: ConfigShape;
        try {
            body = (await c.req.json()) as ConfigShape;
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        let existing: Config | null = null;
        try {
            existing = Config.load();
        } catch {
            // 无现有配置（首次写入）
        }
        const merged: ConfigShape = {
            providers: Object.fromEntries(
                Object.entries(body.providers ?? {}).map(([name, p]) => {
                    const keep = p.apiKey?.trim()
                        ? p.apiKey
                        : existing?.providers[name]?.apiKey ?? "";
                    return [name, { ...p, apiKey: keep }];
                }),
            ),
            default: body.default,
            mcp: body.mcp,
        };
        try {
            Config.save(merged);
            return c.json({ statusMessage: "saved" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    app.patch("/api/config", async (c) => {
        let body: { default?: string; modelId?: string };
        try {
            body = (await c.req.json()) as { default?: string; modelId?: string };
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        let cfg: Config;
        try {
            cfg = Config.load();
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
        try {
            if (body.modelId) {
                const provider = cfg.providers[cfg.default];
                if (!provider)
                    return c.json({ statusMessage: `provider "${cfg.default}" 不存在` }, 400);
                if (!provider.models.some((m) => m.id === body.modelId))
                    return c.json(
                        { statusMessage: `model "${body.modelId}" 不在 provider "${cfg.default}" 的 models 中` },
                        400,
                    );
                provider.defaultModel = body.modelId;
            } else if (body.default) {
                const newDefault = body.default.trim();
                if (!cfg.providers[newDefault])
                    return c.json({ statusMessage: `provider "${newDefault}" 不存在` }, 400);
                cfg.default = newDefault;
            } else {
                return c.json({ statusMessage: "需要 default 或 modelId" }, 400);
            }
            Config.save({
                providers: cfg.providers,
                default: cfg.default,
                mcp: cfg.mcpServers,
            });
            return c.json({ statusMessage: "switched" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    // ==================== misc ====================
    app.get("/api/fs/browse", (c) => {
        const requested = c.req.query("dir") || "";
        const isWin = process.platform === "win32";
        const DRIVES_SENTINEL = "::drives::";

        if (isWin && requested === DRIVES_SENTINEL) {
            const out: { name: string; path: string }[] = [];
            for (let ch = 67; ch <= 90; ch++) {
                const letter = String.fromCharCode(ch);
                const root = `${letter}:\\`;
                try {
                    statSync(root);
                    out.push({ name: `${letter}:`, path: root });
                } catch {
                    // 盘不存在
                }
            }
            return c.json({ current: "此电脑", parent: null, dirs: out });
        }

        const start = requested || os.homedir();
        let resolved = resolve(start);
        try {
            const st = statSync(resolved);
            if (!st.isDirectory()) resolved = dirname(resolved);
        } catch {
            resolved = os.homedir();
        }
        let dirs: { name: string; path: string }[] = [];
        try {
            const entries = readdirSync(resolved, { withFileTypes: true });
            dirs = entries
                .filter((e) => e.isDirectory() && !e.name.startsWith("."))
                .map((e) => ({ name: e.name, path: join(resolved, e.name) }))
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch {
            // 无读权限等
        }
        const root = parsePath(resolved).root;
        const parent =
            resolved === root
                ? isWin
                    ? DRIVES_SENTINEL
                    : null
                : dirname(resolved);
        return c.json({ current: resolved, parent, dirs });
    });

    app.get("/api/search", async (c) => {
        const q = (c.req.query("q") ?? "").trim().toLowerCase();
        if (!q) return c.json({ sessions: [], workspaces: [] });
        const svc = new SessionService();
        const workspaces = WorkspaceRegistry.list();
        const workspacesHits = workspaces
            .filter(
                (w) =>
                    w.name.toLowerCase().includes(q) ||
                    w.rootPath.toLowerCase().includes(q),
            )
            .map((w) => ({ projectKey: w.projectKey, name: w.name, rootPath: w.rootPath }));
        const sessionHits: {
            projectKey: string;
            sessionId: string;
            title: string;
            updatedAt: number;
            workspaceName: string;
            rootPath: string;
        }[] = [];
        const MAX = 50;
        for (const w of workspaces) {
            if (sessionHits.length >= MAX) break;
            try {
                const list = await svc.list(w.projectKey);
                for (const s of list) {
                    if (sessionHits.length >= MAX) break;
                    if ((s.title || "").toLowerCase().includes(q)) {
                        sessionHits.push({
                            projectKey: w.projectKey,
                            sessionId: s.id,
                            title: s.title || "（无标题）",
                            updatedAt: s.updatedAt,
                            workspaceName: w.name,
                            rootPath: w.rootPath,
                        });
                    }
                }
            } catch {
                // 某工作区读盘失败不阻断其他
            }
        }
        sessionHits.sort((a, b) => b.updatedAt - a.updatedAt);
        return c.json({ sessions: sessionHits, workspaces: workspacesHits });
    });

    // ==================== 静态 SPA（prod） ====================
    if (opts.staticDir) {
        const dir = opts.staticDir;
        app.get("/*", (c) => staticOrSpa(c, dir));
    }

    return app;
}

export interface StartResult {
    port: number;
    hostname: string;
    close: () => void;
}

/** 起 server。port/hostname/staticDir 可注入；缺省读 env（PORT/HOSTNAME/ANYCODE_WEB_DIST）。 */
export async function start(opts: {
    port?: number;
    hostname?: string;
    staticDir?: string;
} = {}): Promise<StartResult> {
    const app = createApp({ staticDir: opts.staticDir ?? process.env.ANYCODE_WEB_DIST });
    const port = Number(opts.port ?? process.env.PORT ?? 3000) || 3000;
    const hostname = opts.hostname ?? process.env.HOSTNAME ?? "127.0.0.1";
    const server = serve({ fetch: app.fetch, port, hostname });
    return { port, hostname, close: () => server.close() };
}
