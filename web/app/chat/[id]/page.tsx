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
    // null=探测中, AgentInfo=在, "gone"=真失效(404), "failed"=重试尽仍失败(冷编译/网络)
    const [info, setInfo] = useState<AgentInfo | "gone" | "failed" | null>(null);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setInfo(null);
        (async () => {
            // 探测 agent：404=真失效（重启/TTL/热重载清池）；5xx/网络=冷编译瞬时，重试不算失效。
            // 关键：不能把 5xx 当 gone——刚启动切对话时 [id] 路由冷编译 5xx，agent 其实刚创建在池里。
            let alive: AgentInfo | null = null;
            let trulyGone = false;
            for (let attempt = 0; attempt < 4 && !alive && !trulyGone; attempt++) {
                try {
                    const res = await fetch(`/api/agents/${agentId}`);
                    if (res.status === 404) {
                        trulyGone = true;
                        break;
                    }
                    if (res.ok) {
                        alive = (await res.json()) as AgentInfo;
                        break;
                    }
                    // 5xx → 冷编译，退避后重试
                } catch {
                    // 网络异常 → 重试
                }
                await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            }
            if (cancelled) return;
            if (trulyGone) {
                setInfo("gone");
                return;
            }
            if (!alive) {
                setInfo("failed");
                return;
            }
            setInfo(alive);
            if (!workspaces.length) await dispatch(refreshWorkspaces());
            const list = await apiJson<WorkspaceMeta[]>("/api/workspaces");
            const meta = (list ?? []).find(
                (w) => w.projectKey === alive!.projectKey
            );
            if (meta) dispatch(setSelected(meta));
            dispatch(setActiveSession(alive!.sessionId)); // 高亮侧栏对应会话
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agentId, retry]);

    if (info === "gone") {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-muted-foreground">
                    此会话已失效。
                </p>
                <p className="text-sm text-muted-foreground">
                    请从左侧栏重新打开该会话即可恢复历史。
                </p>
            </div>
        );
    }

    if (info === "failed") {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-muted-foreground">
                    加载会话失败，请重试。
                </p>
                <Button variant="outline" size="sm" onClick={() => setRetry((r) => r + 1)}>
                    重试
                </Button>
            </div>
        );
    }

    if (info === null) {
        return (
            <div className="h-full w-full max-w-3xl mx-auto px-4 py-4 flex flex-col gap-2">
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
            </div>
        );
    }

    return <ChatView agentId={agentId} />;
}

