"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import {
    selectWorkspace,
    setSelected,
    setActiveSession,
    refreshWorkspaces,
} from "@/store/workspaceSlice";
import type { WorkspaceMeta } from "@any-code/domain";
import { ChatView } from "@/components/ChatView";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api";
import {
    messagesToEvents,
    type AgentEvent,
    type HistoryMessage,
} from "@/lib/sseEvents";

// 聊天页 /chat/:sessionId —— sessionId-URL，盘后盾，随时 resume，无"已失效"。
// /chat/new = 新对话（点"新建对话"不调服务端，首条消息时 useAgent 建 session）。
export default function ChatPage() {
    const params = useParams<{ sessionId: string }>();
    const routeSessionId = params.sessionId; // 'new' 或真实 sessionId
    const dispatch = useAppDispatch();
    const { selected, workspaces } = useAppSelector(selectWorkspace);
    // null=加载中, AgentInfo=就绪, "missing"=会话不存在, "noworkspace"=未选工作区
    const [ready, setReady] = useState<
        | { rootPath: string; sessionId: string | null; initialEvents: AgentEvent[] }
        | "missing"
        | "noworkspace"
        | null
    >(null);

    useEffect(() => {
        let cancelled = false;
        setReady(null);
        (async () => {
            // 新对话：无需取历史，用当前选中工作区
            if (routeSessionId === "new") {
                if (!selected) {
                    if (!cancelled) setReady("noworkspace");
                    return;
                }
                if (cancelled) return;
                setReady({
                    rootPath: selected.rootPath,
                    sessionId: null,
                    initialEvents: [],
                });
                dispatch(setActiveSession(null));
                return;
            }
            // 真实 sessionId：取历史（含 projectKey）直读盘
            const data = await apiJson<{
                messages: HistoryMessage[];
                projectKey: string;
            }>(`/api/sessions/${routeSessionId}/history`);
            if (cancelled) return;
            if (!data) {
                setReady("missing");
                return;
            }
            // 按 projectKey 同步工作区选中（直链/刷新时 redux 可能没选中）
            if (!workspaces.length) await dispatch(refreshWorkspaces());
            const ws = (await apiJson<WorkspaceMeta[]>("/api/workspaces")) ?? [];
            const meta = ws.find((w) => w.projectKey === data.projectKey);
            if (meta) dispatch(setSelected(meta));
            dispatch(setActiveSession(routeSessionId));
            setReady({
                rootPath: meta?.rootPath ?? selected?.rootPath ?? data.projectKey,
                sessionId: routeSessionId,
                initialEvents: messagesToEvents(data.messages),
            });
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeSessionId]);

    if (ready === "missing") {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-muted-foreground">
                    会话不存在，请从左侧栏选择一个会话。
                </p>
            </div>
        );
    }

    if (ready === "noworkspace") {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-muted-foreground">
                    请先在顶栏选择一个工作区，再开始新对话。
                </p>
                <Button variant="outline" size="sm" onClick={() => window.history.back()}>
                    返回
                </Button>
            </div>
        );
    }

    if (ready === null) {
        return (
            <div className="h-full w-full max-w-3xl mx-auto px-4 py-4 flex flex-col gap-2">
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
            </div>
        );
    }

    return (
        <ChatView
            key={ready.sessionId ?? "new"}
            sessionId={ready.sessionId}
            rootPath={ready.rootPath}
            initialEvents={ready.initialEvents}
        />
    );
}
