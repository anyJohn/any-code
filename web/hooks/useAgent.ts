"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "@/lib/api";
import { dbgLog, dbgFlushToServer } from "@/lib/streamDebug";
import { useT } from "@/i18n";
import {
    type AgentEvent,
    type AgentEventPayload,
    type InteractionData,
    type InteractionQuestion,
    type PermissionAskData,
    type StreamFrame,
    nextId,
} from "@/lib/sseEvents";
// InteractionData/InteractionQuestion 定义于 sseEvents（AgentEvent union 引用），re-export 保 InteractionModal import 不变。
export type { InteractionData, InteractionQuestion };
export type { PermissionAskData };

/** 权限裁决动作（SPEC-032 B-005）。 */
export type PermissionDecision = "allow_once" | "allow_always" | "deny";

const TERMINAL = new Set(["Done", "Error", "Stopped"]);
/** 断线重连上限（FR-21⑤/FR-30 B-002）：指数退避 0.5s×2^n，5 次后放弃。 */
const MAX_RECONNECT = 5;

/** 事件去重键（attach 重放 vs /history 已载 durable 事件可能重叠）。 */
function eventKey(e: AgentEventPayload): string {
    return `${e.type}|${e.message}|${e.timestamp}`;
}

/**
 * 解析 SSE 流：读 fetch body，按 \n\n 分帧，取 data: 行 JSON.parse。
 * fetch streaming SSE（非 EventSource）——支持 POST 带 body + abort。
 * FR-30：server 发 {seq, event} 帧；兼容裸事件（测试/旧格式）。
 */
async function* parseSSE(
    body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamFrame> {
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of frame.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const json = line.slice(5).trim();
                if (!json) continue;
                try {
                    const parsed = JSON.parse(json) as Partial<StreamFrame> &
                        AgentEventPayload;
                    if (parsed && typeof parsed.seq === "number" && parsed.event) {
                        yield parsed as StreamFrame;
                    } else {
                        yield { seq: -1, event: parsed };
                    }
                } catch {
                    // 跳过损坏帧
                }
            }
        }
    }
}

/**
 * useAgent —— FR-30 后台运行模型。
 * - agent 存活期在 server（AgentManager 托管）；断开连接/切走会话只结束本地订阅，
 *   不中止运行。真停走 POST /stop；关软件（server 退出）才全停。
 * - submit(task)：POST /run（SSE 首订）；流中断自动以 GET /stream?since=N 续传（重连）。
 * - mount 时探测运行中会话并重挂（since=-1 重放 + live），恢复 pending 与 pending ask。
 */
export function useAgent(
    sessionId: string | null,
    rootPath: string,
    initialEvents: AgentEvent[]
) {
    const { t } = useT();
    const [events, setEvents] = useState<AgentEvent[]>(initialEvents);
    const [pending, setPending] = useState(false);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(
        sessionId
    );
    // ask_question 工具阻塞等答案时，服务端发 Interaction 事件→设此状态驱动模态
    const [pendingInteraction, setPendingInteraction] =
        useState<InteractionData | null>(null);
    // 权限裁决请求（SPEC-032）：PermissionAsk 事件（live-only）驱动裁决窗
    const [pendingPermission, setPendingPermission] =
        useState<PermissionAskData | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const attachRef = useRef<AbortController | null>(null);
    // per-run 已见最大 seq（续传 since）
    const lastSeqRef = useRef<number>(-1);
    // events 镜像 ref（attach 去重快照用，避免闭包陈旧）
    const eventsRef = useRef<AgentEvent[]>(initialEvents);
    // 会话 id 镜像（取证日志落盘用；state 在回调闭包里会陈旧）
    const sidRef = useRef<string | null>(sessionId);
    useEffect(() => {
        eventsRef.current = events;
    }, [events]);
    useEffect(() => {
        sidRef.current = currentSessionId;
    }, [currentSessionId]);

    const appendLocal = useCallback(
        (type: "System" | "Error" | "Stopped", message: string) => {
            setEvents((prev) => [
                ...prev,
                { id: nextId("local"), timestamp: Date.now(), type, message } as AgentEvent,
            ]);
        },
        []
    );

    /** 单帧入列：ask 类拦截驱动模态；其余去重（可选）后入 events。
     *  strategic=true 时做数组级查重取证（todo #14）：同 type|message|timestamp 已在数组 → ARRAY-DUP。 */
    const ingest = useCallback(
        (e: AgentEventPayload, seen?: Set<string>, strategic?: boolean) => {
            if (e.type === "Interaction") {
                setPendingInteraction(e.data as InteractionData);
                return;
            }
            if (e.type === "PermissionAsk") {
                setPendingPermission(e.data as PermissionAskData);
                return;
            }
            if (seen) {
                const k = eventKey(e);
                if (seen.has(k)) return;
                seen.add(k);
            }
            setEvents((prev) => {
                // server 的 User 回显与乐观气泡同文则跳过。匹配 id=local-* 而非相邻
                // （create 阶段事件可能插在中间），忽略首尾空白（server 会 trim 任务）
                if (e.type === "User") {
                    const msg = e.message?.trim();
                    const hit =
                        msg !== undefined &&
                        prev.some(
                            (p) =>
                                p.type === "User" &&
                                p.id.startsWith("local") &&
                                p.message?.trim() === msg
                        );
                    if (hit) return prev;
                }
                if (
                    strategic &&
                    prev.some(
                        (p) => p.type === e.type && p.message === e.message && p.timestamp === e.timestamp
                    )
                ) {
                    dbgLog(
                        `ARRAY-DUP type=${e.type} ts=${e.timestamp} msg=${e.message?.slice(0, 30) ?? ""} len=${prev.length}`
                    );
                }
                return [
                    ...prev,
                    { ...e, id: nextId("live") } as AgentEvent,
                ];
            });
        },
        []
    );

    /**
     * 消费一条帧流；返回终态是否到达。seen 传入时做 attach 重放去重。
     * seq 投递闸（bugfix 2026-09-09 思考/回合块重复）：同一 run 的帧可能被多条流
     * 并发投递（mount attach 与 submit pump 交叠、StrictMode 双挂载、重放窗口），
     * 旧逻辑只有 attach 一方有快照去重且快照取自挂载时刻——窗口内的帧两方各入列一次，
     * 渲染成两个相同回合块（如两个 "Iteration 2/150"）。per-run seq 单调，以先到者为准：
     * seq ≤ 本 hook 已投递最大值的帧直接丢弃。seq=-1（synth 提示帧/裸事件兼容）不去重。
     */
    const consumeStream = useCallback(
        async (body: ReadableStream<Uint8Array>, seen?: Set<string>, tag = "pump") => {
            for await (const frame of parseSSE(body)) {
                if (frame.seq >= 0) {
                    if (frame.seq <= lastSeqRef.current) {
                        dbgLog(
                            `${tag} DUP-SKIP seq=${frame.seq} gate=${lastSeqRef.current} type=${frame.event.type}`
                        );
                        continue;
                    }
                    lastSeqRef.current = frame.seq;
                }
                // 战略帧取证（双气泡排查）：高频 Thinking/delta 跳过
                const strategic = !["Thinking", "AssistantDelta", "ToolProgress", "ToolArgProgress", "Usage", "ToolStart"].includes(frame.event.type);
                if (strategic) {
                    dbgLog(
                        `${tag} IN seq=${frame.seq} type=${frame.event.type} gate=${lastSeqRef.current} turn=${(frame.event as { turnId?: string }).turnId?.slice(0, 8) ?? "-"} msg=${frame.event.message?.slice(0, 30) ?? ""}`
                    );
                }
                ingest(frame.event, seen, strategic);
                if (TERMINAL.has(frame.event.type)) {
                    dbgLog(`TERMINAL ${frame.event.type} seq=${frame.seq} gate=${lastSeqRef.current}`);
                    dbgFlushToServer(sidRef.current ?? sessionId);
                    setPending(false);
                    setPendingInteraction(null);
                    setPendingPermission(null);
                    return true;
                }
            }
            return false;
        },
        [ingest]
    );

    /**
     * 泵一条流 + 断线续传循环：首连失败/流中断 → GET /stream?since=N 重挂，
     * 指数退避至 MAX_RECONNECT。terminal / abort / 404（run 已结束）退出。
     */
    const pump = useCallback(
        async (sid: string, url: string, init: RequestInit | undefined, ac: AbortController) => {
            let attempts = 0;
            let curUrl = url;
            let curInit = init;
            while (true) {
                let ok = false;
                try {
                    dbgLog(`pump OPEN ${curInit?.method ?? "GET"} ${curUrl}`);
                    const res = await fetch(curUrl, { ...curInit, signal: ac.signal });
                    if (res.ok && res.body) {
                        ok = true;
                        const terminal = await consumeStream(res.body, undefined, "pump");
                        dbgLog(`pump CLOSE terminal=${terminal}`);
                        if (terminal || ac.signal.aborted) return;
                    }
                } catch {
                    if (ac.signal.aborted) return;
                }
                // 首连即失败（/run 非 200）不重试；后续为流中断重挂
                if (!ok && curInit) {
                    appendLocal("Error", t("agent.runFailed"));
                    setPending(false);
                    return;
                }
                if (attempts >= MAX_RECONNECT) {
                    appendLocal("System", t("agent.connectionLost"));
                    setPending(false);
                    return;
                }
                await new Promise((r) => setTimeout(r, 500 * 2 ** attempts));
                attempts++;
                if (ac.signal.aborted) return;
                curUrl = `/api/sessions/${sid}/stream?since=${lastSeqRef.current}`;
                curInit = undefined;
            }
        },
        [consumeStream, appendLocal, t]
    );

    // mount 时重挂运行中会话（FR-30 B-009）：/stream?since=-1 重放 + live；404 = 空闲。
    // seen 快照按挂载时 events 建立——重放中与 /history 重复的 durable 事件被跳过。
    useEffect(() => {
        const sid = sessionId;
        if (!sid) return;
        const ac = new AbortController();
        attachRef.current = ac;
        void (async () => {
            try {
                const res = await fetch(`/api/sessions/${sid}/stream?since=-1`, {
                    signal: ac.signal,
                });
                if (!res.ok || !res.body) return; // 空闲会话：无流
                dbgLog(`attach OPEN since=-1 sid=${sid}`);
                // 不重置 lastSeqRef：若同 hook 已有流投递过帧（StrictMode 双挂载/提交后
                // attach），重放中 seq ≤ 已投递最大值的帧由 consumeStream 的 seq 闸丢弃。
                // 会话切换经 ChatView key 重挂载（ref 全新），无需此处清理。
                const seen = new Set(eventsRef.current.map(eventKey));
                setPending(true);
                const terminal = await consumeStream(res.body, seen, "attach");
                dbgLog(`attach CLOSE terminal=${terminal}`);
                if (!terminal && !ac.signal.aborted) {
                    await pump(sid, `/api/sessions/${sid}/stream?since=${lastSeqRef.current}`, undefined, ac);
                }
            } catch {
                // 网络失败/本地断开：若仍是活动 attach，收尾 pending
                if (attachRef.current === ac) setPending(false);
            } finally {
                if (attachRef.current === ac) attachRef.current = null;
            }
        })();
        return () => {
            ac.abort(); // 仅断本地订阅；server 端 run 继续跑（FR-30 B-001）
            attachRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // 卸载时断开本地 run 流（同样不中止 server 端任务）
    useEffect(
        () => () => {
            abortRef.current?.abort();
        },
        []
    );

    // 同步提交闸门：pending 是异步 state，拦不住同帧重入（双 Enter/IME 连发）
    const submitGateRef = useRef(false);

    const submit = useCallback(
        async (task: string) => {
            if (!task.trim() || pending || submitGateRef.current) return;
            submitGateRef.current = true;
            try {
                setPending(true);

                // 两步法：新对话先建 session
                let sid = currentSessionId;
                if (!sid) {
                    try {
                        const cr = await fetch("/api/sessions", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ workspacePath: rootPath }),
                        });
                        if (!cr.ok) {
                            setPending(false);
                            return;
                        }
                        const created = (await cr.json()) as { sessionId: string };
                        sid = created.sessionId;
                        setCurrentSessionId(sid);
                        // replaceState 不触发路由重渲染（保留在途流），刷新后能落到 /chat/{sid}
                        window.history.replaceState(null, "", `/chat/${sid}`);
                    } catch {
                        setPending(false);
                        return;
                    }
                }

                // 乐观插入用户消息气泡（右对齐）：不等 SSE 往返，立刻显示
                setEvents((prev) => [
                    ...prev,
                    {
                        id: nextId("local"),
                        timestamp: Date.now(),
                        type: "User",
                        message: task,
                    },
                ]);

                const ac = new AbortController();
                abortRef.current = ac;
                lastSeqRef.current = -1;
                await pump(sid, `/api/sessions/${sid}/run`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ task, workspacePath: rootPath }),
                }, ac);
                abortRef.current = null;
            } finally {
                submitGateRef.current = false;
            }
        },
        [currentSessionId, rootPath, pending, pump]
    );

    const stop = useCallback(async () => {
        // FR-30 B-003：真停走显式 API（断开连接已不再停止 agent）。
        const sid = currentSessionId;
        if (sid) {
            try {
                const res = await fetch(`/api/sessions/${sid}/stop`, { method: "POST" });
                if (res.ok) {
                    const body = (await res.json()) as { status?: string };
                    if (body?.status === "cancelled") {
                        // 排队中取消：不会有终态帧，本地收尾
                        abortRef.current?.abort();
                        attachRef.current?.abort();
                        setPending(false);
                        appendLocal("Stopped", t("agent.queuedTaskCancelled"));
                        return;
                    }
                    // "stopping"：等服务端 Stopped 终态帧收尾
                    return;
                }
            } catch {
                // fallthrough → 本地断流兜底
            }
        }
        abortRef.current?.abort();
        attachRef.current?.abort();
        setPending(false);
    }, [currentSessionId, appendLocal, t]);

    /** 提交 ask_question 答案：POST /interact 解除服务端 handler 阻塞。 */
    const submitInteraction = useCallback(
        async (answers: string[]) => {
            const data = pendingInteraction;
            const sid = currentSessionId;
            if (!data || !sid) return;
            const res = await fetch(`/api/sessions/${sid}/interact`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    interactionId: data.id,
                    answers,
                }),
            });
            if (res.ok) setPendingInteraction(null);
        },
        [pendingInteraction, currentSessionId]
    );

    /** 提交权限裁决：POST /interact 解除服务端阻塞；永久允许/拒绝另落规则（B-006）。 */
    const submitPermission = useCallback(
        async (decision: PermissionDecision, scope: "project" | "global" = "project") => {
            const data = pendingPermission;
            const sid = currentSessionId;
            if (!data || !sid) return;
            const res = await fetch(`/api/sessions/${sid}/interact`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ interactionId: data.id, answers: [decision] }),
            });
            if (!res.ok) return;
            setPendingPermission(null);
            // 永久允许/拒绝：追加规则落盘（内存态由 domain 在裁决时同步追加，此处负责持久化）
            if (decision === "allow_always" || decision === "deny") {
                try {
                    await fetch("/api/config/permissions/rule", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                            tool: data.tool,
                            pattern: data.pattern,
                            action: decision === "allow_always" ? "allow" : "deny",
                            scope,
                            workspacePath: rootPath,
                        }),
                    });
                } catch {
                    // 落盘失败不阻断——本会话内已有内存规则/缓存兜底
                }
            }
        },
        [pendingPermission, currentSessionId, rootPath]
    );

    const clear = useCallback(() => setEvents([]), []);

    /** 重取会话历史并整体替换 events（B-013 截断编辑重发后同步真值） */
    const reloadHistory = useCallback(async () => {
        if (!currentSessionId) return;
        const data = await apiJson<{
            events: AgentEventPayload[];
        }>(`/api/sessions/${currentSessionId}/history`);
        const fresh = (data?.events ?? []).map(
            (e) => ({ ...e, id: nextId("hist") } as AgentEvent)
        );
        setEvents(fresh);
        eventsRef.current = fresh;
    }, [currentSessionId]);

    const appendSystem = useCallback((message: string) => {
        setEvents((prev) => [
            ...prev,
            {
                id: nextId("sys"),
                timestamp: Date.now(),
                type: "System",
                message,
            },
        ]);
    }, []);

    return {
        events,
        pending,
        submit,
        stop,
        clear,
        appendSystem,
        currentSessionId,
        pendingInteraction,
        submitInteraction,
        pendingPermission,
        submitPermission,
        reloadHistory,
    };
}
