"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { useAppSelector } from "@/hooks/useRedux";
import { selectWorkspace } from "@/store/workspaceSlice";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import type { RunningSessionInfo } from "@/lib/sseEvents";

const MIN_W = 200;
const MAX_W = 480;
const DEFAULT_W = 256;
const COLLAPSED_W = 44; // 折叠态 rail 宽度（= 折叠按钮大小）
const STORAGE_KEY = "anycode:sidebarWidth";
const COLLAPSED_KEY = "anycode:sidebarCollapsed";

/**
 * RunningBanner —— 跨会话 pending ask 提醒（FR-30 B-004）。
 * 轮询 GET /api/running（3s，页面可见时）；有"等待确认"且非当前查看的会话时显示提醒条，
 * 点击跳到该会话处理。当前会话的 ask 由 ChatView 的 PermissionModal 承载，不重复提醒。
 */
function RunningBanner() {
    const { activeSessionId } = useAppSelector(selectWorkspace);
    const navigate = useNavigate();
    const { t } = useT();
    const [waiting, setWaiting] = useState<RunningSessionInfo[]>([]);

    useEffect(() => {
        let stopped = false;
        const tick = async () => {
            if (document.visibilityState !== "visible") return;
            const list = await apiJson<RunningSessionInfo[]>("/api/running");
            if (stopped) return;
            setWaiting((list ?? []).filter((s) => s.status === "waiting_ask"));
        };
        const t = setInterval(tick, 3000);
        void tick();
        return () => {
            stopped = true;
            clearInterval(t);
        };
    }, []);

    const target = waiting.find((s) => s.sessionId !== activeSessionId);
    if (!target) return null;
    return (
        <button
            onClick={() => navigate(`/chat/${target.sessionId}`)}
            className="shrink-0 w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-b border-amber-500/30 hover:bg-amber-500/20 transition-colors"
        >
            <span className="size-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
            {t(
                waiting.length > 1
                    ? "shell.bannerWaitingMulti"
                    : "shell.bannerWaitingSingle",
                {
                    title: target.title || t("shell.session"),
                    count: waiting.length,
                }
            )}
        </button>
    );
}

/**
 * AppShell —— 圆角卡片可拖拽布局。
 * 两栏圆角卡片浮于 app 底色，中间窄分割栏（三点 grab handle）可按住拖拽调左右宽度。
 * 宽度 + 折叠态持久化到 localStorage。折叠时侧栏缩成 rail（= 折叠按钮宽）。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
    const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_W);
    const [collapsed, setCollapsed] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // 初始宽度 + 折叠态从 localStorage 读
    useEffect(() => {
        const saved = Number(localStorage.getItem(STORAGE_KEY));
        if (saved >= MIN_W && saved <= MAX_W) setSidebarWidth(saved);
        setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    }, []);

    const onHandleDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const onMove = (ev: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            // 外层 p-2(8px) padding，sidebar 从 rect.left+8 起
            const w = ev.clientX - rect.left - 8;
            setSidebarWidth(Math.max(MIN_W, Math.min(MAX_W, w)));
        };
        const onUp = () => {
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, []);

    // 持久化宽度 + 折叠态
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
    }, [sidebarWidth]);
    useEffect(() => {
        localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    }, [collapsed]);

    return (
        <div ref={containerRef} className="flex-1 min-h-0 flex p-2">
            <aside
                style={{ width: collapsed ? COLLAPSED_W : sidebarWidth }}
                className="shrink-0 rounded-lg border border-border bg-background overflow-hidden flex flex-col transition-[width] duration-150"
            >
                <AppSidebar
                    collapsed={collapsed}
                    onCollapse={() => setCollapsed(true)}
                    onExpand={() => setCollapsed(false)}
                />
            </aside>
            {/* 三点 grab handle：按住拖拽调宽（折叠态隐藏） */}
            {!collapsed && (
                <div
                    onMouseDown={onHandleDown}
                    role="separator"
                    aria-orientation="vertical"
                    className="group shrink-0 w-2 cursor-col-resize flex flex-col items-center justify-center gap-1.5 rounded transition-colors hover:bg-accent/50"
                >
                    <span className="size-1 rounded-full bg-muted-foreground/40 group-hover:bg-foreground/60" />
                    <span className="size-1 rounded-full bg-muted-foreground/40 group-hover:bg-foreground/60" />
                    <span className="size-1 rounded-full bg-muted-foreground/40 group-hover:bg-foreground/60" />
                </div>
            )}
            <div className="flex-1 min-w-0 rounded-lg border border-border bg-background overflow-hidden flex flex-col">
                <header className="shrink-0 border-b border-border bg-background">
                    <AppTopbar />
                </header>
                <RunningBanner />
                <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
            </div>
            <Toaster richColors position="top-center" />
        </div>
    );
}
