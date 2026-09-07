"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronUp, ShieldCheck, ShieldHalf, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

/**
 * PermissionPicker —— 输入框右下角的会话权限模式 pill（SPEC-037，与 ModelPicker
 * 同款 composer 交互）。显示当前生效模式（会话未配置时 server 回退全局默认，无
 * "默认"占位项）；选择即持久化到 session meta，下条消息生效。
 */
const MODES = ["standard", "accept_edits", "trusted"] as const;

export function PermissionPicker({ sessionId }: { sessionId: string | null }) {
    const { t } = useT();
    const [mode, setMode] = useState<string>("standard");
    const [loaded, setLoaded] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        void apiJson<{ mode: string }>(
            `/api/sessions/${sessionId}/permission-mode`
        ).then((d) => {
            if (!cancelled && d?.mode) {
                setMode(d.mode);
                setLoaded(true);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    const switchMode = (m: string) => {
        setMode(m); // 乐观更新
        void apiJson(`/api/sessions/${sessionId}/permission-mode`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: m }),
        });
    };

    if (!sessionId || !loaded) return null;

    const meta = {
        standard: { label: t("perm.standard"), Icon: ShieldCheck, cls: "text-emerald-500" },
        accept_edits: { label: t("perm.acceptEdits"), Icon: ShieldHalf, cls: "text-amber-500" },
        trusted: { label: t("perm.trusted"), Icon: ShieldAlert, cls: "text-red-500" },
    }[mode] ?? { label: mode, Icon: ShieldCheck, cls: "text-muted-foreground" };
    const { label, Icon, cls } = meta;

    return (
        <div ref={rootRef} className="relative">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        title={t("perm.sessionMode")}
                        className={cn(
                            "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground",
                            "hover:bg-accent hover:text-foreground transition-colors"
                        )}
                    >
                        <Icon className={cn("size-3.5", cls)} />
                        <span>{label}</span>
                        <ChevronUp className="size-3 text-muted-foreground/60" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="w-36">
                    <DropdownMenuLabel>{t("perm.sessionMode")}</DropdownMenuLabel>
                    {MODES.map((m) => (
                        <DropdownMenuItem
                            key={m}
                            className="flex items-center justify-between"
                            onClick={() => switchMode(m)}
                        >
                            <span className="inline-flex items-center gap-1.5">
                                {(() => {
                                    const mi = {
                                        standard: { I: ShieldCheck, c: "text-emerald-500" },
                                        accept_edits: { I: ShieldHalf, c: "text-amber-500" },
                                        trusted: { I: ShieldAlert, c: "text-red-500" },
                                    }[m]!;
                                    return <mi.I className={cn("size-3.5", mi.c)} />;
                                })()}
                                {m === "trusted"
                                    ? t("perm.trusted")
                                    : m === "accept_edits"
                                      ? t("perm.acceptEdits")
                                      : t("perm.standard")}
                            </span>
                            {mode === m && <Check className="size-3.5 text-primary" />}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
