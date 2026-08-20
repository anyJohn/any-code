"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    type AgentEvent,
    type HistoryMessage,
    messagesToEvents,
    nextId,
} from "@/lib/sseEvents";

/**
 * useAgent —— initAgent + rxjs 订阅。
 * 事件流不进 Redux，留局部 state。
 * onMounted 先拉历史（resume 回显旧消息），再连 SSE 接增量。
 */
export function useAgent(agentId: string) {
    const [events, setEvents] = useState<AgentEvent[]>([]);
    const [pending, setPending] = useState(false);
    const esRef = useRef<EventSource | null>(null);
    // 防止同一 agentId 的历史被重复加载：dev 下 React StrictMode 会双调用
    // effect，裸 append 会让两份历史（各含 hist-turn-0）叠加 → React key 撞车。
    const historyLoadedFor = useRef<string | null>(null);

    const loadHistory = useCallback(async () => {
        // 同步置位：在 await 前标记，使 StrictMode 的第二次调用立即短路返回
        if (historyLoadedFor.current === agentId) return;
        historyLoadedFor.current = agentId;
        try {
            const res = await fetch(`/api/agents/${agentId}/history`);
            if (!res.ok) return;
            const msgs = (await res.json()) as HistoryMessage[];
            // 首次加载直接替换（此时尚无实时事件），彻底避免重复
            setEvents(messagesToEvents(msgs));
        } catch {
            historyLoadedFor.current = null; // 失败可重试
            // 新建 agent（首条消息前 session 为 null）或历史为空，忽略
        }
    }, [agentId]);

    const connect = useCallback(() => {
        const es = new EventSource(`/api/agents/${agentId}/events`);
        esRef.current = es;
        es.onmessage = (ev) => {
            const e = JSON.parse(ev.data) as Omit<AgentEvent, "id">;
            setEvents((prev) => [...prev, { ...e, id: nextId("live") }]);
            // Done / Error / Stopped 都解除 pending
            if (e.type === "Done" || e.type === "Error" || e.type === "Stopped") {
                setPending(false);
            }
        };
        es.onerror = () => {
            setPending(false); // 连接异常时解除 pending，避免输入框永久锁死
        };
    }, [agentId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await loadHistory();
            if (!cancelled) connect();
        })();
        return () => {
            cancelled = true;
            esRef.current?.close();
        };
    }, [loadHistory, connect]);

    const submit = useCallback(
        (task: string) => {
            if (!task.trim() || pending) return;
            setPending(true);
            // 乐观插入用户消息气泡（右对齐）：不等 SSE 往返，立刻显示。
            // domain 不再发 User 事件（避免与历史回放的 User 重复），所以本地补一条。
            setEvents((prev) => [
                ...prev,
                {
                    id: nextId("local"),
                    timestamp: Date.now(),
                    type: "User",
                    message: task,
                },
            ]);
            fetch(`/api/agents/${agentId}/messages`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ task }),
            }).catch((err) => {
                setPending(false);
                setEvents((prev) => [
                    ...prev,
                    {
                        id: nextId("local"),
                        timestamp: Date.now(),
                        type: "Error",
                        message: `提交失败: ${err instanceof Error ? err.message : String(err)}`,
                    },
                ]);
            });
        },
        [agentId, pending]
    );

    const stop = useCallback(() => {
        fetch(`/api/agents/${agentId}/stop`, { method: "POST" });
    }, [agentId]);

    return { events, pending, submit, stop };
}
