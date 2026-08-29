"use client";

import { useCallback, useRef, useState } from "react";
import {
    type AgentEvent,
    type AgentEventPayload,
    type InteractionData,
    type InteractionQuestion,
    nextId,
} from "@/lib/sseEvents";
// InteractionData/InteractionQuestion 定义于 sseEvents（AgentEvent union 引用），re-export 保 InteractionModal import 不变。
export type { InteractionData, InteractionQuestion };

const TERMINAL = new Set(["Done", "Error", "Stopped"]);

/**
 * 解析 SSE 流：读 fetch body，按 \n\n 分帧，取 data: 行 JSON.parse。
 * fetch streaming SSE（非 EventSource）——支持 POST 带 body + abort=stop。
 */
async function* parseSSE(
    body: ReadableStream<Uint8Array>
): AsyncGenerator<AgentEventPayload> {
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
                    yield JSON.parse(json);
                } catch {
                    // 跳过损坏帧
                }
            }
        }
    }
}

/**
 * useAgent —— 目标 C：连接持有 agent。
 * - 历史由调用方（chat 页）预取传入 initialEvents，hook 不再自取（避免双取）。
 * - submit(task)：新对话（sessionId=null）先 POST /api/sessions 建 session，replaceState 更新 URL
 *   （不触发 Next 重渲染，保留在途 run 流），再 POST /api/sessions/:sessionId/run 流式跑。
 * - stop：abort fetch → 服务端见 disconnect → destroy → 真停（关页面同理）。
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
    const abortRef = useRef<AbortController | null>(null);

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
                    // 更新 URL 不触发 Next 路由重渲染（保留在途流），刷新后能落到 /chat/{sid}
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
            try {
                const res = await fetch(`/api/sessions/${sid}/run`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ task, workspacePath: rootPath }),
                    signal: ac.signal,
                });
                if (!res.ok || !res.body) {
                    setEvents((prev) => [
                        ...prev,
                        {
                            id: nextId("local"),
                            timestamp: Date.now(),
                            type: "Error",
                            message: `运行失败 (HTTP ${res.status})`,
                            error: {
                                message: `HTTP ${res.status}`,
                                name: "Error",
                            },
                        },
                    ]);
                    setPending(false);
                    return;
                }
                for await (const e of parseSSE(res.body)) {
                    if (e.type === "Interaction") {
                        // ask_question 阻塞中：拦截不入 events，设 pendingInteraction 驱动模态
                        setPendingInteraction(e.data as InteractionData);
                    } else {
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
                    }
                    if (TERMINAL.has(e.type)) {
                        setPending(false);
                        setPendingInteraction(null);
                    }
                }
            } catch (err) {
                if (ac.signal.aborted) {
                    // 用户主动停止：abort 关闭 SSE 流时，服务端 STOPPED 事件未必能送达，
                    // 本地补一条 Stopped 标记，让用户看到"已停止"反馈。
                    setEvents((prev) => [
                        ...prev,
                        {
                            id: nextId("local"),
                            timestamp: Date.now(),
                            type: "Stopped",
                            message: "已停止任务",
                        },
                    ]);
                } else {
                    setEvents((prev) => [
                        ...prev,
                        {
                            id: nextId("local"),
                            timestamp: Date.now(),
                            type: "Error",
                            message: `运行失败: ${
                                err instanceof Error ? err.message : String(err)
                            }`,
                            error: {
                                message:
                                    err instanceof Error
                                        ? err.message
                                        : String(err),
                                name: err instanceof Error ? err.name : "Error",
                            },
                        },
                    ]);
                }
                setPending(false);
            } finally {
                abortRef.current = null;
            }
        },
        [currentSessionId, rootPath, pending]
    );

    const stop = useCallback(() => {
        abortRef.current?.abort(); // abort fetch → 服务端 destroy → 真停
    }, []);

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
    };
}
