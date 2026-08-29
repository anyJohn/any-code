"use client";

import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

/**
 * TitleBar —— 桌面端无边框窗口的内置标题栏（仅 Electron 内渲染）。
 * 整栏 .app-drag 可拖窗；右侧三按钮 .app-no-digr 恢复点击。
 * 左：logo + AnyCode 字标；右：最小化 / 最大化·还原 / 关闭。
 * 关窗 = main 进程 server.stop（无后台残留），见 desktop/src/main.ts。
 */
export function TitleBar() {
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        const off = window.anycode?.onMaximizeChange(setMaximized);
        return () => off?.();
    }, []);

    const api = window.anycode;
    if (!api) return null;

    const btn =
        "app-no-drag p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors";

    return (
        <div className="app-drag h-9 shrink-0 flex items-center justify-between px-3 bg-background border-b border-border select-none">
            <div className="flex items-center gap-2 min-w-0">
                <Logo size={16} />
                <span className="text-xs font-semibold tracking-tight text-foreground">
                    AnyCode
                </span>
            </div>
            <div className="flex items-center">
                <button
                    type="button"
                    title="最小化"
                    className={btn}
                    onClick={() => api.minimize()}
                >
                    <Minus className="size-3.5" />
                </button>
                <button
                    type="button"
                    title={maximized ? "还原" : "最大化"}
                    className={btn}
                    onClick={() => api.toggleMaximize()}
                >
                    {maximized ? (
                        <Copy className="size-3.5" />
                    ) : (
                        <Square className="size-3.5" />
                    )}
                </button>
                <button
                    type="button"
                    title="关闭"
                    className={cn(
                        btn,
                        "hover:bg-destructive hover:text-white",
                    )}
                    onClick={() => api.close()}
                >
                    <X className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
