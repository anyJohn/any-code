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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, MessageSquare, Folder, Trash2, Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";

type SessionsStatus = "loading" | "ready" | "error";

/**
 * AppSidebar —— 工作区 Collapsible + sessions。
 * 双重高亮：工作区行 selected.projectKey + 会话行 activeSessionId。
 * 会话支持删除（弹窗二次确认）与重命名（inline 编辑）。
 */
export function AppSidebar() {
    const { selected, workspaces, activeSessionId } =
        useAppSelector(selectWorkspace);
    const dispatch = useAppDispatch();
    const router = useRouter();

    const [sessionsMap, setSessionsMap] = useState<Record<string, SessionMeta[]>>({});
    const [sessionsStatus, setSessionsStatus] = useState<Record<string, SessionsStatus>>({});
    const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
    const [sidebarErr, setSidebarErr] = useState("");
    // 删除目标（弹窗受控）；重命名目标（inline 编辑受控）
    const [deleteTarget, setDeleteTarget] = useState<{
        w: WorkspaceMeta;
        s: SessionMeta;
    } | null>(null);
    const [renameTarget, setRenameTarget] = useState<{
        w: WorkspaceMeta;
        s: SessionMeta;
        value: string;
    } | null>(null);

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
        setSessionsStatus((p) => ({ ...p, [w.projectKey]: "loading" }));
        const list = await apiJson<SessionMeta[]>(
            `/api/workspaces/${w.projectKey}/sessions`
        );
        if (list === null) {
            setSessionsStatus((p) => ({ ...p, [w.projectKey]: "error" }));
            return;
        }
        setSessionsMap((p) => ({ ...p, [w.projectKey]: list }));
        setSessionsStatus((p) => ({ ...p, [w.projectKey]: "ready" }));
    };

    const onToggle = (w: WorkspaceMeta) => {
        const willOpen = !openKeys[w.projectKey];
        if (willOpen && !sessionsMap[w.projectKey]) loadSessions(w);
        dispatch(setSelected(w));
        setOpenKeys((p) => ({ ...p, [w.projectKey]: willOpen }));
    };

    // 点 workspace 名称 → 选中 + 展开 + 跳总览页（首页展示该工作区会话列表）
    const onOpenWorkspace = (w: WorkspaceMeta) => {
        dispatch(setSelected(w));
        setOpenKeys((p) => ({ ...p, [w.projectKey]: true }));
        if (!sessionsMap[w.projectKey]) loadSessions(w);
        router.push("/");
    };

    // 目标 C：newChat/resume 不再 POST 建 agent——只导航。session 由 useAgent 在首条消息时建（两步法），
    // 历史由 chat 页 GET /history 直读盘。故这里无网络往返、无失败态。
    const newChat = (w: WorkspaceMeta) => {
        dispatch(setSelected(w));
        dispatch(setActiveSession(null));
        router.push(`/chat/new`);
    };

    const resume = (w: WorkspaceMeta, sessionId: string) => {
        dispatch(setSelected(w));
        dispatch(setActiveSession(sessionId));
        router.push(`/chat/${sessionId}`);
    };

    const confirmDelete = async () => {
        const t = deleteTarget;
        if (!t) return;
        const r = await apiJson<{ status: string }>(
            `/api/workspaces/${t.w.projectKey}/sessions/${t.s.id}`,
            { method: "DELETE" }
        );
        setDeleteTarget(null);
        if (!r) {
            setSidebarErr("删除会话失败，请重试");
            return;
        }
        // 本地 filter 掉
        setSessionsMap((p) => ({
            ...p,
            [t.w.projectKey]: (p[t.w.projectKey] ?? []).filter(
                (s) => s.id !== t.s.id
            ),
        }));
        // 删的是当前活动 session → 跳回列表（目标 C：无 agent pool 需清理，session 文件已删即可）
        if (activeSessionId === t.s.id) {
            dispatch(setActiveSession(null));
            router.push("/");
        }
    };

    const submitRename = async (t: NonNullable<typeof renameTarget>) => {
        const title = t.value.trim();
        if (!title || title === t.s.title) {
            setRenameTarget(null);
            return;
        }
        const r = await apiJson<{ status: string; title: string }>(
            `/api/workspaces/${t.w.projectKey}/sessions/${t.s.id}`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title }),
            }
        );
        if (!r) {
            setSidebarErr("重命名会话失败，请重试");
            setRenameTarget(null);
            return;
        }
        // 本地更新 title
        setSessionsMap((p) => ({
            ...p,
            [t.w.projectKey]: (p[t.w.projectKey] ?? []).map((s) =>
                s.id === t.s.id ? { ...s, title } : s
            ),
        }));
        setRenameTarget(null);
    };

    return (
        <div className="h-full overflow-y-auto">
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
                        <div
                            className={cn(
                                "flex items-center gap-1 w-full px-2 py-1.5 rounded-md text-sm hover:bg-accent",
                                selected?.projectKey === w.projectKey && "bg-accent"
                            )}
                        >
                            <CollapsibleTrigger asChild>
                                <button
                                    className="shrink-0 p-0.5 rounded hover:bg-accent"
                                    aria-label={
                                        openKeys[w.projectKey] ? "折叠" : "展开"
                                    }
                                >
                                    <ChevronRight
                                        className="size-3.5 transition-transform"
                                        style={{
                                            transform: openKeys[w.projectKey]
                                                ? "rotate(90deg)"
                                                : undefined,
                                        }}
                                    />
                                </button>
                            </CollapsibleTrigger>
                            <button
                                className="flex items-center gap-1.5 flex-1 min-w-0 truncate text-left"
                                onClick={() => onOpenWorkspace(w)}
                            >
                                <Folder className="size-3.5 text-muted-foreground shrink-0" />
                                <span className="truncate">{w.name}</span>
                            </button>
                            <button
                                title="新建对话"
                                className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    newChat(w);
                                }}
                            >
                                <Plus className="size-3.5" />
                            </button>
                        </div>
                        <CollapsibleContent>
                            <div className="ml-4 my-1 flex flex-col gap-1 border-l border-border pl-2">
                                {sidebarErr && (
                                    <p className="px-2 py-0.5 text-[11px] text-destructive">
                                        {sidebarErr}
                                    </p>
                                )}
                                {(sessionsStatus[w.projectKey] === "loading" ||
                                    (!sessionsStatus[w.projectKey] &&
                                        !sessionsMap[w.projectKey])) &&
                                    Array.from({ length: 3 }).map((_, i) => (
                                        <Skeleton
                                            key={i}
                                            className="h-6 mx-2 rounded"
                                        />
                                    ))}
                                {sessionsStatus[w.projectKey] === "error" && (
                                    <p className="px-2 py-1 text-[11px] text-destructive">
                                        加载会话失败
                                    </p>
                                )}
                                {sessionsStatus[w.projectKey] === "ready" &&
                                    (sessionsMap[w.projectKey] ?? []).map((s) => {
                                        const rt = renameTarget?.s.id === s.id ? renameTarget : null;
                                        const isActive =
                                            selected?.projectKey === w.projectKey &&
                                            activeSessionId === s.id;
                                        return (
                                            <div
                                                key={s.id}
                                                className={cn(
                                                    "group flex items-center gap-1 px-2 py-1 rounded border border-transparent hover:border-border hover:bg-accent text-xs",
                                                    isActive && "bg-accent text-foreground border-border"
                                                )}
                                            >
                                                <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                                                {rt ? (
                                                    <Input
                                                        className="h-5 px-1 text-xs flex-1"
                                                        value={rt.value}
                                                        autoFocus
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) =>
                                                            setRenameTarget({
                                                                ...rt,
                                                                value: e.target.value,
                                                            })
                                                        }
                                                        onKeyDown={(e) => {
                                                            e.stopPropagation();
                                                            if (e.key === "Enter")
                                                                submitRename(rt);
                                                            else if (e.key === "Escape")
                                                                setRenameTarget(null);
                                                        }}
                                                        onBlur={() => setRenameTarget(null)}
                                                    />
                                                ) : (
                                                    <button
                                                        className="flex-1 min-w-0 truncate text-left"
                                                        title={s.title || "（无标题）"}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            resume(w, s.id);
                                                        }}
                                                        onDoubleClick={(e) => {
                                                            e.stopPropagation();
                                                            setRenameTarget({
                                                                w,
                                                                s,
                                                                value: s.title || "",
                                                            });
                                                        }}
                                                    >
                                                        {s.title || "（无标题）"}
                                                    </button>
                                                )}
                                                {!rt && (
                                                    <span className="flex items-center gap-0.5 shrink-0">
                                                        <button
                                                            title="重命名"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setRenameTarget({
                                                                    w,
                                                                    s,
                                                                    value: s.title || "",
                                                                });
                                                            }}
                                                        >
                                                            <Pencil className="size-3 text-muted-foreground" />
                                                        </button>
                                                        <button
                                                            title="删除"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setDeleteTarget({ w, s });
                                                            }}
                                                        >
                                                            <Trash2 className="size-3 text-muted-foreground" />
                                                        </button>
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                {sessionsStatus[w.projectKey] === "ready" &&
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

            <Dialog
                open={!!deleteTarget}
                onOpenChange={(o) => !o && setDeleteTarget(null)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>删除会话？</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        删除后无法恢复：{deleteTarget?.s.title || "（无标题）"}
                    </p>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="ghost">取消</Button>
                        </DialogClose>
                        <Button variant="destructive" onClick={confirmDelete}>
                            删除
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
