"use client";

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import {
    selectWorkspace,
    setSelected,
    setActiveSession,
    refreshWorkspaces,
} from "@/store/workspaceSlice";
import type { WorkspaceMeta } from "@any-code/domain";
import type { SessionListItem } from "@/lib/sseEvents";
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
import {
    ChevronRight,
    MessageSquare,
    Folder,
    Trash2,
    Pencil,
    Plus,
    Settings,
    Search,
    PanelLeftClose,
    PanelLeftOpen,
    Loader2,
    Clock3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import { fmtTokens } from "@/lib/format";
import { useT } from "@/i18n";
import { DirectoryPicker } from "./DirectoryPicker";
import { Logo } from "./Logo";
import { Link } from "react-router-dom";

type SessionsStatus = "loading" | "ready" | "error";

/**
 * AppSidebar —— 工作区 Collapsible + sessions。
 * 双重高亮：工作区行 selected.projectKey + 会话行 activeSessionId。
 * 会话支持删除（弹窗二次确认）与重命名（inline 编辑）。
 * 顶部工具栏：添加工作区（开 DirectoryPicker）+ 折叠侧栏（收成 rail）。
 */
export function AppSidebar({
    collapsed,
    onCollapse,
    onExpand,
}: {
    collapsed: boolean;
    onCollapse: () => void;
    onExpand: () => void;
}) {
    const { selected, workspaces, activeSessionId, sessionsVersion } =
        useAppSelector(selectWorkspace);
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const { t } = useT();

    const [sessionsMap, setSessionsMap] = useState<Record<string, SessionListItem[]>>({});
    const sessionsMapRef = useRef(sessionsMap);
    sessionsMapRef.current = sessionsMap;
    const [sessionsStatus, setSessionsStatus] = useState<Record<string, SessionsStatus>>({});
    const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
    const [sidebarErr, setSidebarErr] = useState("");
    const [pickerOpen, setPickerOpen] = useState(false);
    const [addError, setAddError] = useState("");
    // 删除目标（弹窗受控）；重命名目标（inline 编辑受控）
    const [deleteTarget, setDeleteTarget] = useState<{
        w: WorkspaceMeta;
        s: SessionListItem;
    } | null>(null);
    const [renameTarget, setRenameTarget] = useState<{
        w: WorkspaceMeta;
        s: SessionListItem;
        value: string;
    } | null>(null);
    // 工作区删除目标（弹窗受控）
    const [deleteWsTarget, setDeleteWsTarget] = useState<WorkspaceMeta | null>(null);
    // 搜索：query 即时受控、debounced 驱动 fetch、results 扁平（跨所有工作区）
    const [query, setQuery] = useState("");
    const [debounced, setDebounced] = useState("");
    const [results, setResults] = useState<{
        sessions: {
            projectKey: string;
            sessionId: string;
            title: string;
            updatedAt: number;
            workspaceName: string;
            rootPath: string;
        }[];
        workspaces: { projectKey: string; name: string; rootPath: string }[];
    } | null>(null);
    const [searching, setSearching] = useState(false);

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

    // 会话列表变更信号（新会话创建后 bumpSessions）→ 重拉当前工作区 sessions。
    // 初值 0 跳过（挂载时上面 [selected] effect 已拉过）。
    useEffect(() => {
        if (selected && sessionsVersion > 0) loadSessions(selected);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionsVersion]);

    const loadSessions = async (w: WorkspaceMeta) => {
        setSessionsStatus((p) => ({ ...p, [w.projectKey]: "loading" }));
        const list = await apiJson<SessionListItem[]>(
            `/api/workspaces/${w.projectKey}/sessions`
        );
        if (list === null) {
            setSessionsStatus((p) => ({ ...p, [w.projectKey]: "error" }));
            return;
        }
        setSessionsMap((p) => ({ ...p, [w.projectKey]: list }));
        setSessionsStatus((p) => ({ ...p, [w.projectKey]: "ready" }));
    };

    // FR-30 B-004：运行状态轮询（3s，页面可见时）。静默刷新已加载工作区的会话列表——
    // 服务端在 SessionMeta 上合并 status/pendingAsk（running/waiting_ask/queued），驱动行内徽标。
    useEffect(() => {
        const tick = () => {
            if (document.visibilityState !== "visible") return;
            for (const projectKey of Object.keys(sessionsMapRef.current)) {
                void (async () => {
                    const list = await apiJson<SessionListItem[]>(
                        `/api/workspaces/${projectKey}/sessions`
                    );
                    if (list) setSessionsMap((p) => ({ ...p, [projectKey]: list }));
                })();
            }
        };
        const t = setInterval(tick, 3000);
        return () => clearInterval(t);
    }, []);

    const onPicked = async (path: string) => {
        setAddError("");
        const meta = await apiJson<WorkspaceMeta>("/api/workspaces", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path }),
        });
        if (!meta) {
            setAddError(t("sidebar.addWorkspaceFailed"));
            return;
        }
        await dispatch(refreshWorkspaces());
        dispatch(setSelected(meta));
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
        navigate("/");
    };

    // newChat/resume 只导航，不建 agent。session 由 useAgent 在首条消息时建（两步法），
    // 历史由 chat 页 GET /history 直读盘。故这里无网络往返、无失败态。
    const newChat = (w: WorkspaceMeta) => {
        dispatch(setSelected(w));
        dispatch(setActiveSession(null));
        navigate(`/chat/new`);
    };

    const resume = (w: WorkspaceMeta, sessionId: string) => {
        dispatch(setSelected(w));
        dispatch(setActiveSession(sessionId));
        navigate(`/chat/${sessionId}`);
    };

    // 搜索 debounce（300ms）→ debounced
    useEffect(() => {
        const t = setTimeout(() => setDebounced(query.trim()), 300);
        return () => clearTimeout(t);
    }, [query]);

    // debounced 非空 → fetch /api/search；空 → 清结果
    useEffect(() => {
        if (!debounced) {
            setResults(null);
            setSearching(false);
            return;
        }
        let cancelled = false;
        setSearching(true);
        apiJson<{
            sessions: {
                projectKey: string;
                sessionId: string;
                title: string;
                updatedAt: number;
                workspaceName: string;
                rootPath: string;
            }[];
            workspaces: { projectKey: string; name: string; rootPath: string }[];
        }>(`/api/search?q=${encodeURIComponent(debounced)}`).then((r) => {
            if (cancelled) return;
            setResults(r ?? { sessions: [], workspaces: [] });
            setSearching(false);
        });
        return () => {
            cancelled = true;
        };
    }, [debounced]);

    // 搜索结果点击：定位 redux 里的 WorkspaceMeta（找不到则构造最小 meta）→ 选中 + 导航
    const findOrBuildMeta = (projectKey: string, name: string, rootPath: string): WorkspaceMeta => {
        return (
            workspaces.find((w) => w.projectKey === projectKey) ?? {
                rootPath,
                projectKey,
                name,
                addedAt: 0,
                lastUsedAt: 0,
            }
        );
    };
    const openSearchSession = (hit: {
        projectKey: string;
        sessionId: string;
        workspaceName: string;
        rootPath: string;
    }) => {
        const meta = findOrBuildMeta(hit.projectKey, hit.workspaceName, hit.rootPath);
        dispatch(setSelected(meta));
        dispatch(setActiveSession(hit.sessionId));
        setQuery("");
        navigate(`/chat/${hit.sessionId}`);
    };
    const openSearchWorkspace = (hit: {
        projectKey: string;
        name: string;
        rootPath: string;
    }) => {
        const meta = findOrBuildMeta(hit.projectKey, hit.name, hit.rootPath);
        dispatch(setSelected(meta));
        setQuery("");
        navigate("/");
    };

    const confirmDeleteWorkspace = async () => {
        const target = deleteWsTarget;
        if (!target) return;
        const r = await apiJson<{ status: string }>("/api/workspaces", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: target.rootPath }),
        });
        setDeleteWsTarget(null);
        if (!r) {
            setSidebarErr(t("sidebar.deleteWorkspaceFailed"));
            return;
        }
        // 清该工作区本地 sessions 缓存 + 刷新注册表
        setSessionsMap((p) => {
            const next = { ...p };
            delete next[target.projectKey];
            return next;
        });
        await dispatch(refreshWorkspaces());
        if (selected?.projectKey === target.projectKey) {
            dispatch(setSelected(null));
            dispatch(setActiveSession(null));
            navigate("/");
        }
    };

    const confirmDelete = async () => {
        const target = deleteTarget;
        if (!target) return;
        const r = await apiJson<{ status: string }>(
            `/api/workspaces/${target.w.projectKey}/sessions/${target.s.id}`,
            { method: "DELETE" }
        );
        setDeleteTarget(null);
        if (!r) {
            setSidebarErr(t("sidebar.deleteSessionFailed"));
            return;
        }
        // 本地 filter 掉
        setSessionsMap((p) => ({
            ...p,
            [target.w.projectKey]: (p[target.w.projectKey] ?? []).filter(
                (s) => s.id !== target.s.id
            ),
        }));
        // 删的是当前活动 session → 跳回列表（session 文件已删即可）
        if (activeSessionId === target.s.id) {
            dispatch(setActiveSession(null));
            navigate("/");
        }
    };

    const submitRename = async (target: NonNullable<typeof renameTarget>) => {
        const title = target.value.trim();
        if (!title || title === target.s.title) {
            setRenameTarget(null);
            return;
        }
        const r = await apiJson<{ status: string; title: string }>(
            `/api/workspaces/${target.w.projectKey}/sessions/${target.s.id}`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title }),
            }
        );
        if (!r) {
            setSidebarErr(t("sidebar.renameSessionFailed"));
            setRenameTarget(null);
            return;
        }
        // 本地更新 title
        setSessionsMap((p) => ({
            ...p,
            [target.w.projectKey]: (p[target.w.projectKey] ?? []).map((s) =>
                s.id === target.s.id ? { ...s, title } : s
            ),
        }));
        setRenameTarget(null);
    };

    // 折叠态：rail（logo + 展开按钮 + 设置图标）
    if (collapsed) {
        return (
            <div className="h-full flex flex-col items-center py-2 gap-1">
                <Link
                    to="/"
                    title="AnyCode"
                    className="p-1 rounded-md hover:bg-accent"
                >
                    <Logo size={22} />
                </Link>
                <button
                    onClick={onExpand}
                    title={t("sidebar.expandSidebar")}
                    className="p-2 rounded-md hover:bg-accent"
                >
                    <PanelLeftOpen className="size-4" />
                </button>
                <div className="flex-1" />
                <Link
                    to="/settings"
                    title={t("sidebar.settings")}
                    className="p-2 rounded-md hover:bg-accent"
                >
                    <Settings className="size-4 text-muted-foreground" />
                </Link>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* 品牌头：logo + AnyCode（点回首页）+ 折叠按钮 */}
            <div className="shrink-0 flex items-center gap-1 px-2 h-12 border-b border-border">
                <Link
                    to="/"
                    title="AnyCode"
                    className="flex items-center gap-2 flex-1 min-w-0 rounded-md px-1.5 py-1 hover:bg-accent transition-colors"
                >
                    <Logo size={22} />
                    <span className="text-sm font-semibold tracking-tight text-foreground">
                        AnyCode
                    </span>
                </Link>
                <button
                    onClick={onCollapse}
                    title={t("sidebar.collapseSidebar")}
                    className="p-1.5 rounded-md hover:bg-accent shrink-0"
                >
                    <PanelLeftClose className="size-4" />
                </button>
            </div>

            {/* 添加工作区（整行） */}
            <div className="shrink-0 p-2 border-b border-border">
                <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => setPickerOpen(true)}
                >
                    <Plus className="size-4" /> {t("sidebar.addWorkspace")}
                </Button>
            </div>

            {/* 搜索框：输入即 debounce 300ms → GET /api/search，结果扁平替换树 */}
            <div className="shrink-0 p-2 border-b border-border">
                <div className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 focus-within:ring-1 focus-within:ring-ring">
                    <Search className="size-3.5 text-muted-foreground shrink-0" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t("sidebar.searchPlaceholder")}
                        className="flex-1 min-w-0 border-0 bg-transparent text-sm py-1.5 outline-none"
                    />
                    {query && (
                        <button
                            onClick={() => setQuery("")}
                            className="text-muted-foreground hover:text-foreground text-xs shrink-0"
                            title={t("sidebar.clearSearch")}
                        >
                            ×
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
                {debounced ? (
                    <div className="p-2 flex flex-col gap-2">
                        {searching && (
                            <p className="px-2 py-1 text-xs text-muted-foreground">
                                {t("sidebar.searching")}
                            </p>
                        )}
                        {!searching && results &&
                            results.workspaces.length === 0 &&
                            results.sessions.length === 0 && (
                                <p className="px-2 py-4 text-xs text-muted-foreground">
                                    {t("sidebar.noResults")}
                                </p>
                            )}
                        {results && results.workspaces.length > 0 && (
                            <div className="flex flex-col gap-1">
                                <p className="px-2 text-[11px] uppercase text-muted-foreground">
                                    {t("sidebar.workspaces")}
                                </p>
                                {results.workspaces.map((w) => (
                                    <button
                                        key={w.projectKey}
                                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left"
                                        onClick={() => openSearchWorkspace(w)}
                                    >
                                        <Folder className="size-3.5 text-muted-foreground shrink-0" />
                                        <span className="truncate">{w.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {results && results.sessions.length > 0 && (
                            <div className="flex flex-col gap-1">
                                <p className="px-2 text-[11px] uppercase text-muted-foreground">
                                    {t("sidebar.sessions")}
                                </p>
                                {results.sessions.map((s) => (
                                    <button
                                        key={s.projectKey + s.sessionId}
                                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left"
                                        onClick={() => openSearchSession(s)}
                                    >
                                        <MessageSquare className="size-3.5 text-muted-foreground shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate">{s.title}</div>
                                            <div className="text-[11px] text-muted-foreground truncate">
                                                {s.workspaceName}
                                            </div>
                                        </div>
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                            {new Date(s.updatedAt).toLocaleDateString()}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="p-2 flex flex-col gap-1">
                        {workspaces.length === 0 && (
                            <p className="px-2 py-4 text-xs text-muted-foreground">
                                {t("sidebar.emptyHint")}
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
                                        aria-label={t(
                                            openKeys[w.projectKey]
                                                ? "sidebar.collapse"
                                                : "sidebar.expand"
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
                                    title={t("sidebar.newChat")}
                                    className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        newChat(w);
                                    }}
                                >
                                    <Plus className="size-3.5" />
                                </button>
                                <button
                                    title={t("sidebar.deleteWorkspace")}
                                    className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteWsTarget(w);
                                    }}
                                >
                                    <Trash2 className="size-3.5" />
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
                                            {t("sidebar.loadSessionsFailed")}
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
                                                            title={s.title || t("sidebar.untitled")}
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
                                                            {s.title || t("sidebar.untitled")}
                                                        </button>
                                                    )}
                                                    {/* FR-22：会话累计 tokens（title 挂精确值） */}
                                                    {!rt && s.usage && (
                                                        <span
                                                            className="shrink-0 tabular-nums text-[10px] text-muted-foreground/60"
                                                            title={`${s.usage.promptTokens} + ${s.usage.completionTokens} tokens`}
                                                        >
                                                            {fmtTokens(
                                                                s.usage.promptTokens +
                                                                    s.usage.completionTokens
                                                            )}
                                                        </span>
                                                    )}
                                                    {/* FR-30 B-004：运行状态徽标（名称右侧） */}
                                                    {!rt && s.status === "running" && (
                                                        <Loader2
                                                            className="size-3 shrink-0 animate-spin text-primary"
                                                            aria-label={t("sidebar.running")}
                                                        />
                                                    )}
                                                    {!rt && s.status === "waiting_ask" && (
                                                        <span
                                                            className="size-2 shrink-0 rounded-full bg-amber-500 animate-pulse"
                                                            title={
                                                                s.pendingAsk?.tool
                                                                    ? t("sidebar.waitingConfirmWithTool", {
                                                                          tool: s.pendingAsk.tool,
                                                                      })
                                                                    : t("sidebar.waitingConfirm")
                                                            }
                                                        />
                                                    )}
                                                    {!rt && s.status === "queued" && (
                                                        <Clock3
                                                            className="size-3 shrink-0 text-muted-foreground"
                                                            aria-label={t("sidebar.queued")}
                                                        />
                                                    )}
                                                    {!rt && (
                                                        <span className="flex items-center gap-0.5 shrink-0">
                                                            <button
                                                                title={t("sidebar.rename")}
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
                                                                title={t("common.delete")}
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
                                                {t("sidebar.noSessions")}
                                            </p>
                                        )}
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    ))}
                </div>
            )}
            </div>

            {addError && (
                <p className="shrink-0 px-3 py-1 text-[11px] text-destructive border-t border-border">
                    {addError}
                </p>
            )}

            <div className="shrink-0 border-t border-border p-2">
                <Link
                    to="/settings"
                    className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-sm hover:bg-accent"
                >
                    <Settings className="size-3.5 text-muted-foreground shrink-0" />
                    <span>{t("sidebar.settings")}</span>
                </Link>
            </div>

            <DirectoryPicker
                open={pickerOpen}
                onOpenChange={(v) => {
                    setPickerOpen(v);
                    if (!v) setAddError("");
                }}
                onPicked={onPicked}
            />

            <Dialog
                open={!!deleteTarget}
                onOpenChange={(o) => !o && setDeleteTarget(null)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("sidebar.deleteSessionTitle")}</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        {t("sidebar.deleteSessionBody", {
                            title: deleteTarget?.s.title || t("sidebar.untitled"),
                        })}
                    </p>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="ghost">{t("common.cancel")}</Button>
                        </DialogClose>
                        <Button variant="destructive" onClick={confirmDelete}>
                            {t("common.delete")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={!!deleteWsTarget}
                onOpenChange={(o) => !o && setDeleteWsTarget(null)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("sidebar.deleteWorkspaceTitle")}</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        {t("sidebar.deleteWorkspaceBody", {
                            name: deleteWsTarget?.name ?? "",
                        })}
                    </p>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="ghost">{t("common.cancel")}</Button>
                        </DialogClose>
                        <Button
                            variant="destructive"
                            onClick={confirmDeleteWorkspace}
                        >
                            {t("sidebar.remove")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
