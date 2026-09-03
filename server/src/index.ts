import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, join, parse as parsePath, resolve } from "node:path";
import os from "node:os";
import {
    AnyAgent,
    Config,
    DEFAULT_TITLE,
    createSnapshotService,
    loadProjectPermissions,
    saveProjectPermissions,
    createWorkspace,
    maskApiKey,
    getRegisteredAbilities,
    isAbilityEnabled,
    projectKeyOf,
    resolveContextWindow,
    resolveInteraction,
    hasInteraction,
    runRipgrep,
    SessionService,
    listModels,
    testModels,
    type AgentEvent,
    type ConfigShape,
    type PermissionRule,
    type SessionKey,
    type Workspace,
    WorkspaceRegistry,
    workspaceConfigDir,
} from "@any-code/domain";
import { runningSessions, runningWorkspaces } from "./singleFlight.js";
import { getAgentManager, TERMINAL, type StreamFrame } from "./agentManager.js";

/** 解析拉取/测试模型的凭据：表单 apiKey 留空=保留原值 → 用 config.yaml 已存 key（providerName 匹配）。 */
function resolveModelCreds(
    baseURL: string | undefined,
    apiKey: string | undefined,
    providerName: string | undefined
): { key: string; base?: string } {
    let key = apiKey?.trim() ?? "";
    let base: string | undefined = baseURL?.trim() || undefined;
    const name = providerName?.trim();
    if (name && (!key || !base)) {
        try {
            const existing = Config.load().providers[name];
            if (existing) {
                if (!key) key = existing.apiKey ?? "";
                if (!base) base = existing.baseURL;
            }
        } catch {
            // 坏 config：当作无已存凭据
        }
    }
    return { key, base };
}

/**
 * AnyCode HTTP server (hono) —— 静态 SPA 的薄 driving adapter。
 * 只依赖 @any-code/domain，无业务逻辑；29 个 API 路由 + 1 个静态 SPA catch-all
 * （Web Request/Response 同构，SSE 用 ReadableStream 原样）。见 DEC-007 / SPEC-028 / SPEC-033。
 */
// events 已可序列化 by construction（domain serializeError 把 Error 转 plain ErrorPayload），
// SSE 与持久化均直接 JSON.stringify，无需 replacer（SPEC-030 B-002/B-010/I-001）。
// TERMINAL / DURABLE_TYPES 持久化与终态判定职责在 agentManager.ts。

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
        const session = await service.create(projectKey, DEFAULT_TITLE);
        return c.json({ sessionId: session.id, projectKey }, 201);
    });

    // POST /api/sessions/:sessionId/run —— SSE 首订（FR-30 / SPEC-033）：
    // agent 交给 AgentManager 托管，断开连接只退订不中止；停止走 POST /stop 或终态。
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

        const manager = getAgentManager();
        if (runningSessions().has(sessionId) || manager.isBusy(sessionId))
            return c.json({ statusMessage: "session already running" }, 409);
        const wsKey = projectKeyOf(workspacePath);
        // create 窗口的单飞预留（与 /compact 共用 runningSessions；finalize/失败路径清除）
        runningSessions().add(sessionId);
        runningWorkspaces().add(wsKey); // rollback 竞态守卫同样覆盖 create 窗口

        const headers = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        };

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const enc = new TextEncoder();
                let closed = false;
                let unsub: (() => void) | null = null;

                const send = (frame: StreamFrame) => {
                    if (closed) return;
                    try {
                        controller.enqueue(
                            enc.encode(`data: ${JSON.stringify(frame)}\n\n`),
                        );
                    } catch {
                        // controller 已关
                    }
                };
                const synth = (message: string): StreamFrame => ({
                    seq: -1,
                    event: { type: "System", message, timestamp: Date.now() } as AgentEvent,
                });
                const finish = () => {
                    if (closed) return;
                    closed = true;
                    clearInterval(keepalive);
                    unsub?.();
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

                // 客户端断开（切会话/关标签页/刷新）→ 只退订，agent 继续跑（SPEC-033 B-001）
                c.req.raw.signal.addEventListener(
                    "abort",
                    () => {
                        manager.cancelQueued(sessionId);
                        finish();
                    },
                    { once: true },
                );

                void (async () => {
                    // 并发闸（B-006）：满载排队，提示帧先行
                    if (!manager.hasFreeSlot()) {
                        send(synth("已达到并发运行上限，任务进入队列等待空闲槽位…"));
                    }
                    const release = await manager.acquire(sessionId, wsKey);
                    if (closed) {
                        // 排队期间客户端已断开：放弃启动
                        release();
                        runningSessions().delete(sessionId);
                        runningWorkspaces().delete(wsKey);
                        return;
                    }
                    // 兜底 try/catch：create 失败（坏 config 等）必须释放槽位并返错误帧
                    let agent: AnyAgent;
                    try {
                        agent = await AnyAgent.create({ rootPath: workspacePath, sessionId });
                    } catch (e) {
                        release();
                        runningSessions().delete(sessionId);
                        runningWorkspaces().delete(wsKey);
                        send(synth(`agent 启动失败：${(e as Error).message}`));
                        finish();
                        return;
                    }
                    if (!agent.getSession()) {
                        release();
                        runningSessions().delete(sessionId);
                        runningWorkspaces().delete(wsKey);
                        agent.destroy();
                        send(synth("session not found"));
                        finish();
                        return;
                    }
                    manager.register(agent, sessionId, workspacePath);
                    // 重放本 run 已有事件（create 阶段的 System/Warning 等），seq 即 history 下标
                    const history = agent.eventHistory$.value;
                    for (let i = 0; i < history.length; i++) send({ seq: i, event: history[i] });
                    unsub = manager.addSubscriber(sessionId, (frame) => {
                        send(frame);
                        if (TERMINAL.has(frame.event.type)) finish();
                    });
                    agent.submit(task);
                })();
            },
        });

        return new Response(stream, { headers });
    });

    // GET /api/sessions/:sessionId/stream?since=N —— 重挂续传（FR-30 B-002/B-008）：
    // 重放 seq > since 的本 run 事件后续订 live 帧；agent 未运行 → 404（客户端回退 /history 全量刷新）。
    app.get("/api/sessions/:sessionId/stream", (c) => {
        const sessionId = c.req.param("sessionId");
        const entry = getAgentManager().get(sessionId);
        if (!entry) return c.json({ statusMessage: "session not running" }, 404);
        const sinceRaw = c.req.query("since");
        const since = sinceRaw === undefined || sinceRaw === "" ? -1 : Number(sinceRaw);

        const headers = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        };
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const enc = new TextEncoder();
                let closed = false;
                let unsub: (() => void) | null = null;
                const send = (frame: StreamFrame) => {
                    if (closed) return;
                    try {
                        controller.enqueue(
                            enc.encode(`data: ${JSON.stringify(frame)}\n\n`),
                        );
                    } catch {
                        // controller 已关
                    }
                };
                const finish = () => {
                    if (closed) return;
                    closed = true;
                    clearInterval(keepalive);
                    unsub?.();
                    try {
                        controller.close();
                    } catch {
                        // 已关
                    }
                };
                const keepalive = setInterval(() => {
                    if (closed) return;
                    try {
                        controller.enqueue(enc.encode(": keepalive\n\n"));
                    } catch {
                        // controller 已关
                    }
                }, 15000);
                c.req.raw.signal.addEventListener("abort", finish, { once: true });

                // 同步重放 + 订阅之间无 await，不会漏帧。
                // 过期 ask 防护：重放中的 PermissionAsk/Interaction 若已裁决/已答，
                // 不下发（否则重挂时弹已处理过的模态）。仍 pending 的以 server 真值放行。
                const manager2 = getAgentManager();
                const entry2 = manager2.get(sessionId);
                const history = entry2?.agent.eventHistory$.value ?? [];
                const start = Number.isFinite(since) ? Math.max(0, Math.floor(since) + 1) : 0;
                for (let i = start; i < history.length; i++) {
                    const ev = history[i];
                    if (ev?.type === "PermissionAsk") {
                        const askId = (ev.data as { id?: string })?.id;
                        if (entry2?.pendingAsk?.id !== askId) continue;
                    }
                    if (ev?.type === "Interaction") {
                        const iid = (ev.data as { id?: string })?.id;
                        if (!hasInteraction(iid ?? "")) continue;
                    }
                    send({ seq: i, event: ev });
                }
                unsub = getAgentManager().addSubscriber(sessionId, (frame) => {
                    send(frame);
                    if (TERMINAL.has(frame.event.type)) finish();
                });
            },
        });
        return new Response(stream, { headers });
    });

    // POST /api/sessions/:sessionId/stop —— 显式停止（FR-30 B-003）：任意视图可停任意运行中会话
    app.post("/api/sessions/:sessionId/stop", (c) => {
        const sessionId = c.req.param("sessionId");
        const result = getAgentManager().stop(sessionId);
        if (result === null) return c.json({ statusMessage: "session not running" }, 404);
        return c.json({ status: result });
    });

    // GET /api/running —— 全局运行快照（FR-30 B-004）：跨工作区 queued/running/waiting_ask + 标题，
    // 供 AppShell 的跨会话 pending ask 提醒与侧栏徽标兜底。
    app.get("/api/running", async (c) => {
        const service = new SessionService();
        const list = getAgentManager().statusList();
        const out = await Promise.all(
            list.map(async (s) => {
                let title = "";
                try {
                    const found = await service.findSession(s.sessionId);
                    title = found?.session.title ?? "";
                } catch {
                    // 查不到标题不影响状态
                }
                return { ...s, title };
            }),
        );
        return c.json(out);
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
            events: found.session.events ?? [],
            projectKey: found.key.projectKey,
            // AR-23：system prompt 指纹（动态装配内容不入盘，哈希作审计锚点）
            sysfp: found.session.sysfp,
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
            // 内置能力可枚举列表（注册器）+ 当前开关态（SPEC-031 B-012）
            const registered = getRegisteredAbilities().map((a) => ({
                name: a.name,
                kind: a.kind,
                description: a.description,
                enabled: isAbilityEnabled(cfg, a.name),
            }));
            return c.json({
                providers,
                default: cfg.default,
                mcp: cfg.mcpServers,
                abilities: { registered, config: cfg.abilities },
                permissions: cfg.permissions,
                maxConcurrentRuns: cfg.maxConcurrentRuns,
                ui: cfg.ui,
                pricing: cfg.pricing,
            });
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
            // 表单未含的段（abilities）保留已存值，防部分提交误清
            abilities: body.abilities ?? existing?.abilities,
            // 表单不含 gitBashPath（Windows 专用，install.ps1/launcher 维护）——保留已存值
            gitBashPath: body.gitBashPath ?? existing?.gitBashPath,
            // 表单不含 permissions 段时保留已存值（Settings 权限卡与整表单保存共用此路由）
            permissions: body.permissions ?? existing?.permissions,
            // 表单不含 maxConcurrentRuns 时保留已存值（FR-30）
            maxConcurrentRuns: body.maxConcurrentRuns ?? existing?.maxConcurrentRuns,
            // 表单不含 ui 段时保留已存值（FR-29 语言偏好）
            ui: body.ui ?? existing?.ui,
            // 表单不含 pricing 段时保留已存值（FR-22 模型单价）
            pricing: body.pricing ?? existing?.pricing,
        };
        try {
            Config.save(merged);
            return c.json({ statusMessage: "saved" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    // 拉取 provider 模型列表（Settings「拉取模型」）：{ baseURL, apiKey?, providerName? } → { models }
    // apiKey 表单留空 = 保留原值 → 用 config 已存 key（providerName 匹配）。
    app.post("/api/config/models/fetch", async (c) => {
        let body: {
            baseURL?: string;
            apiKey?: string;
            providerName?: string;
        };
        try {
            body = (await c.req.json()) as {
                baseURL?: string;
                apiKey?: string;
                providerName?: string;
            };
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const { key, base } = resolveModelCreds(
            body.baseURL,
            body.apiKey,
            body.providerName
        );
        if (!key) {
            return c.json(
                {
                    statusMessage:
                        "需要 apiKey（表单留空=保留原值——若本地已存 key 会自动用；新 provider 请先填 key 或保存后重试）",
                },
                400
            );
        }
        try {
            const models = await listModels(base, key);
            return c.json({ models });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    // 测试模型可用性（Settings「测试模型」）：{ baseURL, apiKey?, providerName?, models } → { results }
    app.post("/api/config/models/test", async (c) => {
        let body: {
            baseURL?: string;
            apiKey?: string;
            providerName?: string;
            models?: string[];
        };
        try {
            body = (await c.req.json()) as {
                baseURL?: string;
                apiKey?: string;
                providerName?: string;
                models?: string[];
            };
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        if (!body.models?.length) {
            return c.json({ statusMessage: "models 不能为空" }, 400);
        }
        const { key, base } = resolveModelCreds(
            body.baseURL,
            body.apiKey,
            body.providerName
        );
        if (!key) {
            return c.json(
                {
                    statusMessage:
                        "需要 apiKey（表单留空=保留原值——若本地已存 key 会自动用；新 provider 请先填 key 或保存后重试）",
                },
                400
            );
        }
        try {
            const results = await testModels(base, key, body.models);
            return c.json({ results });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    app.patch("/api/config", async (c) => {
        let body: { default?: string; modelId?: string; language?: string };
        try {
            body = (await c.req.json()) as {
                default?: string;
                modelId?: string;
                language?: string;
            };
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
            // FR-29：语言偏好（ui.language）单独 PATCH——与 default/modelId 互不依赖
            if (body.language !== undefined) {
                if (body.language !== "zh" && body.language !== "en") {
                    return c.json({ statusMessage: "language 仅支持 zh / en" }, 400);
                }
                cfg.ui = { ...cfg.ui, language: body.language };
            }
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
            } else if (body.language === undefined) {
                return c.json({ statusMessage: "需要 default / modelId / language 之一" }, 400);
            }
            Config.save({
                providers: cfg.providers,
                default: cfg.default,
                mcp: cfg.mcpServers,
                // PATCH 只改 default/modelId/language——其余段原样保留，防误清
                gitBashPath: cfg.gitBashPath,
                abilities: cfg.abilities,
                permissions: cfg.permissions,
                maxConcurrentRuns: cfg.maxConcurrentRuns,
                ui: cfg.ui,
                pricing: cfg.pricing,
            });
            return c.json({ statusMessage: "switched" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    // 裁决"永久允许/拒绝"落盘（SPEC-032 B-006）：单独小路由——避免 web 走整表单
    // POST /api/config（GET 的 apiKey 已脱敏，整表单回存会污染真实 key）。
    app.post("/api/config/permissions/rule", async (c) => {
        let body: {
            tool?: string;
            pattern?: string;
            action?: string;
            scope?: string;
            workspacePath?: string;
        } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const tool = body.tool?.trim();
        const action = body.action;
        const scope = body.scope === "global" ? "global" : "project";
        if (!tool || (action !== "allow" && action !== "ask" && action !== "deny"))
            return c.json({ statusMessage: "tool and action required" }, 400);
        const rule: PermissionRule = {
            tool,
            pattern: body.pattern?.trim() || undefined,
            action,
        };
        try {
            if (scope === "global") {
                const cfg = Config.load();
                cfg.permissions.rules.push(rule);
                Config.save({
                    providers: cfg.providers,
                    default: cfg.default,
                    mcp: cfg.mcpServers,
                    gitBashPath: cfg.gitBashPath,
                    abilities: cfg.abilities,
                    permissions: cfg.permissions,
                });
            } else {
                const workspacePath = body.workspacePath?.trim();
                if (!workspacePath)
                    return c.json({ statusMessage: "workspacePath required for project scope" }, 400);
                const ws = createWorkspace(workspacePath);
                let rules: PermissionRule[] = [];
                try {
                    rules = loadProjectPermissions(ws);
                } catch {
                    // 损坏文件：覆盖为仅含新规则（fail-safe）
                }
                saveProjectPermissions(ws, [...rules, rule]);
            }
            return c.json({ statusMessage: "saved" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 500);
        }
    });

    // ==================== snapshots（AR-4 快照与回滚） ====================
    // 快照存于 ~/.anycode/snapshots/<projectKey>/（shadow-git，项目目录零污染）。
    app.get("/api/workspaces/:projectKey/snapshots", (c) => {
        const workspace = resolveWorkspace(c.req.param("projectKey"));
        if (!workspace) return c.json({ statusMessage: "workspace not found" }, 404);
        const svc = createSnapshotService(workspace.rootPath);
        return c.json({ gitAvailable: svc.available(), snapshots: svc.list() });
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

/** 起 server。port/hostname/staticDir 可注入；port 缺省读 env（PORT/ANYCODE_WEB_DIST）。 */
export async function start(opts: {
    port?: number;
    hostname?: string;
    staticDir?: string;
} = {}): Promise<StartResult> {
    const app = createApp({ staticDir: opts.staticDir ?? process.env.ANYCODE_WEB_DIST });
    const port = Number(opts.port ?? process.env.PORT ?? 3000) || 3000;
    // 恒绑回环地址，不读 HOSTNAME env：Windows 下它是计算机名、Linux shell 也常设为机器名，
    // 当主机名解析会绑到非回环地址，破坏"仅本机监听"立场（desktop 需要时经 opts 显式注入）。
    const hostname = opts.hostname ?? "127.0.0.1";
    const server = serve({ fetch: app.fetch, port, hostname });
    // FR-30 B-007：进程退出统一清理运行中 agent（不留孤儿 LLM 流 / bash / MCP 子进程）
    const shutdown = (signal: string) => {
        getAgentManager().stopAll();
        try {
            server.close();
        } catch {
            // 已关
        }
        process.exit(0);
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    return { port, hostname, close: () => server.close() };
}
