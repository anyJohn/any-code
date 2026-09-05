"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import {
    selectWorkspace,
    setSelected,
    setActiveSession,
    refreshWorkspaces,
} from "@/store/workspaceSlice";
import type { WorkspaceMeta } from "@any-code/domain";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Plus, FolderOpen, Languages, MessageSquare, ChevronUp, PanelLeft, X } from "lucide-react";
import { DirectoryPicker } from "./DirectoryPicker";
import { Logo } from "./Logo";
import { apiJson } from "@/lib/api";
import type { WorkspaceWithSessions } from "@/lib/sseEvents";
import { useT, type Language } from "@/i18n";

interface RecentSession {
    projectKey: string;
    workspaceName: string;
    sessionId: string;
    title: string;
    updatedAt: number;
}

/**
 * AppTopbar —— 当前工作区名 + 下拉（最近会话，取代原"最近工作区"——用户需求 2026-09-05）。
 * 数据复用 GET /api/workspaces（内联 sessions），按 updatedAt 倒序取前 12；点击跳会话。
 * 窄屏（SPEC-036 B-003）：最左抽屉开关按钮（md:hidden）——侧栏在窄屏是覆盖式抽屉，
 * 侧栏内部的折叠按钮随抽屉出屏，打开入口必须放这里。
 */
export function AppTopbar({
    sidebarMobileOpen,
    onToggleSidebarMobile,
}: {
    sidebarMobileOpen?: boolean;
    onToggleSidebarMobile?: () => void;
}) {
    const { workspaces } = useAppSelector(selectWorkspace);
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const { language, setLanguage, t } = useT();
    const [pickerOpen, setPickerOpen] = useState(false);
    const [addError, setAddError] = useState("");
    const [recent, setRecent] = useState<RecentSession[]>([]);
    const [menuOpen, setMenuOpen] = useState(false);

    // 一键切换（FR-29）：本地即时生效 + localStorage + PATCH config 持久化（Provider 内处理）
    const toggleLanguage = () =>
        setLanguage((language === "zh" ? "en" : "zh") as Language);

    useEffect(() => {
        dispatch(refreshWorkspaces());
    }, [dispatch]);

    // 菜单打开时拉取最近会话（复用 /api/workspaces 内联 sessions，零新端点）
    useEffect(() => {
        if (!menuOpen) return;
        let cancelled = false;
        void (async () => {
            const list =
                (await apiJson<WorkspaceWithSessions[]>("/api/workspaces")) ?? [];
            if (cancelled) return;
            const flat: RecentSession[] = list.flatMap((w) =>
                (w.sessions ?? []).map((s) => ({
                    projectKey: w.projectKey,
                    workspaceName: w.name,
                    sessionId: s.id,
                    title: s.title,
                    updatedAt: s.updatedAt,
                }))
            );
            flat.sort((a, b) => b.updatedAt - a.updatedAt);
            setRecent(flat.slice(0, 12));
        })();
        return () => {
            cancelled = true;
        };
    }, [menuOpen]);

    const openSession = (r: RecentSession) => {
        const meta = workspaces.find((w) => w.projectKey === r.projectKey);
        if (meta) dispatch(setSelected(meta));
        dispatch(setActiveSession(r.sessionId));
        navigate(`/chat/${r.sessionId}`);
    };

    const onPicked = async (path: string) => {
        setAddError("");
        const meta = await apiJson<WorkspaceMeta>("/api/workspaces", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path }),
        });
        if (!meta) {
            setAddError(t("topbar.addWorkspaceFailed"));
            return;
        }
        await dispatch(refreshWorkspaces());
        dispatch(setSelected(meta));
    };

    return (
        <div className="flex items-center gap-3 px-4 h-12">
            {onToggleSidebarMobile && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 px-2 md:hidden"
                    title={t("shell.toggleSidebar")}
                    onClick={onToggleSidebarMobile}
                >
                    {sidebarMobileOpen ? (
                        <X className="size-4" />
                    ) : (
                        <PanelLeft className="size-4" />
                    )}
                </Button>
            )}
            <Logo size={20} className="shrink-0" />
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                {/* 触发器 = 会话历史 pill（与菜单内容一致）；工作区名降级为纯文本展示（切换归侧栏） */}
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5">
                        <MessageSquare className="size-4" />
                        <span>{t("topbar.recentSessions")}</span>
                        <ChevronUp className="size-3 text-muted-foreground" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80">
                    <DropdownMenuLabel>{t("topbar.recentSessions")}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {recent.length === 0 && (
                        <div className="px-2 py-3 text-xs text-muted-foreground">
                            {t("topbar.noSessions")}
                        </div>
                    )}
                    {recent.map((r) => (
                        <DropdownMenuItem
                            key={r.sessionId}
                            className="flex flex-col items-start gap-0.5"
                            onClick={() => openSession(r)}
                        >
                            <span className="flex items-center gap-1.5 w-full min-w-0">
                                <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                                <span className="text-sm truncate">
                                    {r.title || t("home.untitled")}
                                </span>
                            </span>
                            <span className="text-[11px] text-muted-foreground truncate w-full">
                                {r.workspaceName} · {new Date(r.updatedAt).toLocaleString()}
                            </span>
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setPickerOpen(true)}>
                        <Plus className="size-4" /> {t("topbar.addWorkspace")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {addError && (
                <span className="text-xs text-destructive truncate">
                    {addError}
                </span>
            )}

            {/* 语言切换（FR-29）：显目标语言 */}
            <Button
                variant="ghost"
                size="sm"
                className="ml-auto shrink-0 gap-1.5 px-2"
                title={t("topbar.switchLanguage")}
                onClick={toggleLanguage}
            >
                <Languages className="size-4" />
                <span className="text-xs">{language === "zh" ? "EN" : "中文"}</span>
            </Button>

            <DirectoryPicker
                open={pickerOpen}
                onOpenChange={(v) => {
                    setPickerOpen(v);
                    if (!v) setAddError("");
                }}
                onPicked={onPicked}
            />
        </div>
    );
}
