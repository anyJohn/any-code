/** sessions 路由（自 index.ts 机械拆分，零逻辑改动）。 */
import {
    AnyAgent,
    Config,
    DEFAULT_TITLE,
    SessionService,
    hasInteraction,
    projectKeyOf,
    resolveInteraction,
    type AgentEvent,
} from "@any-code/domain";
import { getWorkspaceJobs } from "../shared.js";
import { StreamFrame, TERMINAL, getAgentManager } from "../agentManager.js";
import { runningSessions, runningWorkspaces } from "../singleFlight.js";

import type { Hono } from "hono";

export function registerSessionsRoutes(app: Hono): void {
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
                        agent = await AnyAgent.create({ rootPath: workspacePath, sessionId, jobs: getWorkspaceJobs(wsKey) });
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

    // POST /api/sessions/:sessionId/queue —— queue 消息：运行中入队用户消息，agentLoop
    // 迭代边界注入当前对话。未在运行返回 queued:false，前端回退走 /run 正常提交。
    app.post("/api/sessions/:sessionId/queue", async (c) => {
        const sessionId = c.req.param("sessionId");
        const body = await c.req.json<{ message?: string }>().catch(() => null);
        const message = body?.message?.trim();
        if (!message) return c.json({ statusMessage: "message required" }, 400);
        const agent = getAgentManager().get(sessionId)?.agent;
        const id = agent?.queueUserMessage(message) ?? null;
        if (id === null) return c.json({ queued: false }, 409);
        return c.json({ queued: true, id });
    });

    // DELETE /api/sessions/:sessionId/queue/:qid —— 移除尚未注入的队列消息
    app.delete("/api/sessions/:sessionId/queue/:qid", (c) => {
        const agent = getAgentManager().get(c.req.param("sessionId"))?.agent;
        if (!agent) return c.json({ statusMessage: "session not running" }, 404);
        return c.json({ removed: agent.cancelQueuedMessage(c.req.param("qid")) });
    });

    // GET /api/sessions/:sessionId/queue —— 当前待注入的队列消息（前端队列展示）
    app.get("/api/sessions/:sessionId/queue", (c) => {
        const agent = getAgentManager().get(c.req.param("sessionId"))?.agent;
        return c.json({ items: agent?.listQueuedMessages() ?? [] });
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

    // POST /api/sessions/:sessionId/compact —— SSE（用户需求 2026-09-05）：
    // 进度帧 {type:"progress", phase, generatedTokens?} + 终帧 {type:"result"|...}。
    // 压缩占用会话（single-flight 与 /run 共用锁）。
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

        const focus = body?.focus?.trim() || undefined;
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
                const send = (obj: unknown) => {
                    if (closed) return;
                    try {
                        controller.enqueue(
                            enc.encode(`data: ${JSON.stringify(obj)}\n\n`)
                        );
                    } catch {
                        // controller 已关
                    }
                };
                const finish = () => {
                    if (closed) return;
                    closed = true;
                    running.delete(sessionId);
                    try {
                        controller.close();
                    } catch {
                        // 已关
                    }
                };
                void (async () => {
                    let agent: AnyAgent | null = null;
                    try {
                        agent = await AnyAgent.create({
                            rootPath: workspacePath,
                            sessionId,
                        });
                        if (!agent.getSession()) {
                            agent.destroy();
                            send({ type: "error", text: "session not found" });
                            return;
                        }
                        const res = await agent.compact(focus, (p) => send({ type: "progress", ...p }));
                        send({
                            type: "result",
                            beforeTokens: res.beforeTokens,
                            afterTokens: res.afterTokens,
                            compacted: res.compacted,
                        });
                    } catch (err) {
                        send({
                            type: "error",
                            text: err instanceof Error ? err.message : String(err),
                        });
                    } finally {
                        agent?.destroy();
                        finish();
                    }
                })();
            },
        });
        return new Response(stream, { headers });
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

    // 会话级权限模式（SPEC-037）：GET 读当前（无 → 全局默认）；POST 持久化
    app.get("/api/sessions/:sessionId/permission-mode", async (c) => {
        const service = new SessionService();
        const found = await service.findSession(c.req.param("sessionId"));
        if (!found) return c.json({ statusMessage: "session not found" }, 404);
        const fallback = Config.load().permissions.mode ?? "standard";
        return c.json({ mode: found.session.permissionMode ?? fallback });
    });

    app.post("/api/sessions/:sessionId/permission-mode", async (c) => {
        let body: { mode?: string } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const mode = body?.mode;
        if (mode !== "standard" && mode !== "accept_edits" && mode !== "trusted")
            return c.json({ statusMessage: "mode 需为 standard/accept_edits/trusted" }, 400);
        const service = new SessionService();
        const found = await service.findSession(c.req.param("sessionId"));
        if (!found) return c.json({ statusMessage: "session not found" }, 404);
        await service.setPermissionMode(found.key, mode);
        return c.json({ statusMessage: "saved" });
    });

    // 截断会话到前 keep 条 user 消息（SPEC-036 B-013 编辑重发）：其后消息/事件删除。
    // 运行中会话拒绝（409）；文件状态不自动回滚——用户可配合快照回滚（/snapshots）。
    app.post("/api/sessions/:sessionId/truncate", async (c) => {
        const sessionId = c.req.param("sessionId");
        const running = getAgentManager()
            .statusList()
            .some((s) => s.sessionId === sessionId);
        if (running)
            return c.json(
                { statusMessage: "会话正在运行，请先停止再编辑重发" },
                409,
            );
        let body: { keepUserMessages?: number } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const keep = body?.keepUserMessages;
        if (typeof keep !== "number" || keep < 0)
            return c.json({ statusMessage: "keepUserMessages required" }, 400);
        const service = new SessionService();
        const found = await service.findSession(sessionId);
        if (!found) return c.json({ statusMessage: "session not found" }, 404);
        const kept = await service.truncateToUserMessages(found.key, keep);
        return c.json({ kept });
    });

    app.post("/api/sessions/:sessionId/interact", async (c) => {        let body: { interactionId?: string; answers?: string[] } = {};
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
}
