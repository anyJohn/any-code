"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
    useEffect(() => {
        eventsRef.current = events;
    }, [events]);

    const appendLocal = useCallback(
        (type: "System" | "Error" | "Stopped", message: string) => {
            setEvents((prev) => [
                ...prev,
                { id: nextId("local"), timestamp: Date.now(), type, message } as AgentEvent,
            ]);
        },
        []
    );

    /** 单帧入列：ask 类拦截驱动模态；其余去重（可选）后入 events。 */
    const ingest = useCallback(
        (e: AgentEventPayload, seen?: Set<string>) => {
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
                // 去重：server 的 User 事件与乐观插入的 user 气泡重复（同 message），跳过
                if (
                    e.type === "User" &&
                    prev.length > 0 &&
                    prev[prev.length - 1].type === "User" &&
                    prev[prev.length - 1].message === e.message
                ) {
                    return prev;
                }
                return [
                    ...prev,
                    { ...e, id: nextId("live") } as AgentEvent,
                ];
            });
        },
        []
    );

    /** 消费一条帧流；返回终态是否到达。seen 传入时做 attach 重放去重。 */
    const consumeStream = useCallback(
        async (body: ReadableStream<Uint8Array>, seen?: Set<string>) => {
            for await (const frame of parseSSE(body)) {
                lastSeqRef.current = Math.max(lastSeqRef.current, frame.seq);
                ingest(frame.event, seen);
                if (TERMINAL.has(frame.event.type)) {
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
                    const res = await fetch(curUrl, { ...curInit, signal: ac.signal });
                    if (res.ok && res.body) {
                        ok = true;
                        const terminal = await consumeStream(res.body);
                        if (terminal || ac.signal.aborted) return;
                    }
                } catch {
                    if (ac.signal.aborted) return;
                }
                // 首连即失败（/run 非 200）不重试；后续为流中断重挂
                if (!ok && curInit) {
                    appendLocal("Error", `运行失败，请检查服务端状态`);
                    setPending(false);
                    return;
                }
                if (attempts >= MAX_RECONNECT) {
                    appendLocal("System", "连接中断，多次重连失败；任务仍在后台运行，可稍后重进会话查看。");
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
        [consumeStream, appendLocal]
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
                lastSeqRef.current = -1;
                const seen = new Set(eventsRef.current.map(eventKey));
                setPending(true);
                const terminal = await consumeStream(res.body, seen);
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

    const submit = useCallback(
        async (task: string) => {
            if (!task.trim() || pending) return;
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
                        appendLocal("Stopped", "已取消排队任务");
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
    }, [currentSessionId, appendLocal]);

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
    };
}
