"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import {
    selectWorkspace,
    setSelected,
    setActiveSession,
    refreshWorkspaces,
} from "@/store/workspaceSlice";
import type { WorkspaceMeta, SessionMeta } from "@any-code/domain";
import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, MessageSquare, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";

/**
 * AppSidebar —— 工作区 Collapsible + sessions。
 * 双重高亮：工作区行 selected.projectKey + 会话行 activeSessionId。
 */
export function AppSidebar() {
    const { selected, workspaces, activeSessionId } =
        useAppSelector(selectWorkspace);
    const dispatch = useAppDispatch();
    const router = useRouter();

    const [sessionsMap, setSessionsMap] = useState<Record<string, SessionMeta[]>>({});
    const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});

    useEffect(() => {
        dispatch(refreshWorkspaces());
    }, [dispatch]);

    // 选中工作区变化时自动展开 + 加载 sessions（chat 页加载 / 点 workspace）
    useEffect(() => {
        if (selected) {
            setOpenKeys((p) => ({ ...p, [selected.projectKey]: true }));
            if (!sessionsMap[selected.projectKey]) {
                loadSessions(selected);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected]);

    const loadSessions = async (w: WorkspaceMeta) => {
        // apiJson 内部对 dev 冷编译 5xx 重试一次，失败返回 null（不抛未捕获异常）
        const list = await apiJson<SessionMeta[]>(
            `/api/workspaces/${w.projectKey}/sessions`
        );
        if (list) {
            setSessionsMap((p) => ({ ...p, [w.projectKey]: list }));
        }
    };

    const onToggle = (w: WorkspaceMeta) => {
        const willOpen = !openKeys[w.projectKey];
        if (willOpen && !sessionsMap[w.projectKey]) loadSessions(w);
        dispatch(setSelected(w));
        setOpenKeys((p) => ({ ...p, [w.projectKey]: willOpen }));
    };

    const newChat = async (w: WorkspaceMeta) => {
        const data = await apiJson<{ id: string }>("/api/agents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ workspacePath: w.rootPath }),
        });
        if (!data) return; // 创建失败时不跳转，避免落到无效路由
        dispatch(setActiveSession(null)); // 新对话首条消息后才落盘
        router.push(`/chat/${data.id}`);
    };

    const resume = async (w: WorkspaceMeta, sessionId: string) => {
        const data = await apiJson<{ id: string }>("/api/agents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                workspacePath: w.rootPath,
                sessionId,
            }),
        });
        if (!data) return;
        dispatch(setActiveSession(sessionId)); // 乐观高亮该会话
        router.push(`/chat/${data.id}`);
    };

    return (
        <ScrollArea className="h-full">
            <div className="p-2 flex flex-col gap-1">
                {workspaces.length === 0 && (
                    <p className="px-2 py-4 text-xs text-muted-foreground">
                        顶栏「添加工作区」选一个本地目录开始
                    </p>
                )}
                {workspaces.map((w) => (
                    <Collapsible
                        key={w.projectKey}
                        open={!!openKeys[w.projectKey]}
                        onOpenChange={() => onToggle(w)}
                    >
                        <CollapsibleTrigger
                            className={cn(
                                "flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left",
                                selected?.projectKey === w.projectKey && "bg-accent"
                            )}
                        >
                            <ChevronRight
                                className="size-3.5 transition-transform"
                                style={{
                                    transform: openKeys[w.projectKey]
                                        ? "rotate(90deg)"
                                        : undefined,
                                }}
                            />
                            <Folder className="size-3.5 text-muted-foreground" />
                            <span className="truncate">{w.name}</span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div className="ml-4 my-1 flex flex-col gap-0.5 border-l border-border pl-2">
                                <button
                                    className="flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-accent text-left"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        newChat(w);
                                    }}
                                >
                                    <MessageSquare className="size-3" /> 新建对话
                                </button>
                                {(sessionsMap[w.projectKey] ?? []).map((s) => (
                                    <button
                                        key={s.id}
                                        className={cn(
                                            "flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-accent text-left truncate",
                                            selected?.projectKey ===
                                                w.projectKey &&
                                                activeSessionId === s.id &&
                                                "bg-accent text-foreground"
                                        )}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            resume(w, s.id);
                                        }}
                                    >
                                        <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                                        <span className="truncate">
                                            {s.title || "（无标题）"}
                                        </span>
                                    </button>
                                ))}
                                {openKeys[w.projectKey] &&
                                    (sessionsMap[w.projectKey] ?? []).length === 0 && (
                                        <p className="px-2 py-1 text-[11px] text-muted-foreground">
                                            暂无会话
                                        </p>
                                    )}
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                ))}
            </div>
        </ScrollArea>
    );
}
