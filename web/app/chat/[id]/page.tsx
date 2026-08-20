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
import { apiJson } from "@/lib/api";

interface AgentInfo {
    workspacePath: string;
    projectKey: string;
    sessionId: string | null;
}

// 聊天页 /chat/:agentId —— 深链直达：拉 agent 元信息同步工作区/会话到状态。
// agent 池是内存态，dev 热重载或服务重启会清空池：此时 agentId 失效，
// 不应再挂 ChatView（否则 useAgent 会去拉 /history、连 /events，全部 404 刷屏）。
// 故先探测 agent 是否还在：在则渲染 ChatView，不在则提示重新打开。
export default function ChatPage() {
    const params = useParams<{ id: string }>();
    const agentId = String(params.id);
    const dispatch = useAppDispatch();
    const { workspaces } = useAppSelector(selectWorkspace);
    // null=探测中, AgentInfo=在, "gone"=已失效
    const [info, setInfo] = useState<AgentInfo | "gone" | null>(null);

    useEffect(() => {
        let cancelled = false;
        setInfo(null);
        (async () => {
            // apiJson 对 dev 冷编译 5xx 自带一次重试；返回 null 表示确实不在
            const data = await apiJson<AgentInfo>(`/api/agents/${agentId}`);
            if (cancelled) return;
            if (!data) {
                setInfo("gone");
                return;
            }
            setInfo(data);
            if (!workspaces.length) await dispatch(refreshWorkspaces());
            const list = await apiJson<WorkspaceMeta[]>("/api/workspaces");
            const meta = (list ?? []).find(
                (w) => w.projectKey === data.projectKey
            );
            if (meta) dispatch(setSelected(meta));
            dispatch(setActiveSession(data.sessionId)); // 高亮侧栏对应会话
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agentId]);

    if (info === "gone") {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-muted-foreground">
                    此会话的服务端实例已失效（开发服务器热重载 / 重启会清空内存态 agent 池）。
                </p>
                <p className="text-sm text-muted-foreground">
                    请从左侧栏重新打开该会话即可恢复历史。
                </p>
            </div>
        );
    }

    if (info === null) {
        return (
            <div className="h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">加载中…</p>
            </div>
        );
    }

    return <ChatView agentId={agentId} />;
}
