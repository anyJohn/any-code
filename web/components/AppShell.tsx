"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";

const MIN_W = 200;
const MAX_W = 480;
const DEFAULT_W = 256;
const STORAGE_KEY = "anycode:sidebarWidth";

/**
 * AppShell —— 圆角卡片可拖拽布局。
 * 两栏圆角卡片浮于 app 底色，中间窄分割栏（三点 grab handle）可按住拖拽调左右宽度。
 * 宽度持久化到 localStorage。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
    const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_W);
    const containerRef = useRef<HTMLDivElement>(null);

    // 初始宽度从 localStorage 读
    useEffect(() => {
        const saved = Number(localStorage.getItem(STORAGE_KEY));
        if (saved >= MIN_W && saved <= MAX_W) setSidebarWidth(saved);
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

    // 持久化宽度（拖拽结束后下次生效，节流：直接写每次也行，量小）
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
    }, [sidebarWidth]);

    return (
        <div ref={containerRef} className="h-screen flex p-2 bg-muted/50">
            <aside
                style={{ width: sidebarWidth }}
                className="shrink-0 rounded-lg border border-border bg-background overflow-hidden flex flex-col"
            >
                <AppSidebar />
            </aside>
            {/* 三点 grab handle：按住拖拽调宽 */}
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
            <div className="flex-1 min-w-0 rounded-lg border border-border bg-background overflow-hidden flex flex-col">
                <header className="shrink-0 border-b border-border bg-background">
                    <AppTopbar />
                </header>
                <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
            </div>
            <Toaster richColors position="top-center" />
        </div>
    );
}
