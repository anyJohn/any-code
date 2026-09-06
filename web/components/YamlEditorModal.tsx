"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * config.yaml 编辑弹窗（RR 设置优化）：hljs yaml 高亮 overlay + 透明 textarea。
 * 确认 → POST /api/config/raw（server 校验可解析 + 备份 .bak + 原文写入）。
 */
export function YamlEditorModal({
    onClose,
    onSaved,
}: {
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useT();
    const [yaml, setYaml] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const preRef = useRef<HTMLPreElement>(null);

    useEffect(() => {
        let cancelled = false;
        void apiJson<{ yaml: string } | { statusMessage: string }>(
            "/api/config/raw"
        ).then((data) => {
            if (cancelled) return;
            if (data && "yaml" in data) setYaml(data.yaml);
            else setError((data as { statusMessage?: string })?.statusMessage ?? "load failed");
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const html = useMemo(() => {
        if (!yaml) return "";
        try {
            return hljs.highlight(yaml, { language: "yaml", ignoreIllegals: true }).value;
        } catch {
            return "";
        }
    }, [yaml]);

    const confirm = async () => {
        setSaving(true);
        const res = await apiJson<{ statusMessage: string } | { statusMessage: string }>(
            "/api/config/raw",
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ yaml }),
            }
        );
        setSaving(false);
        if (res && "statusMessage" in res && res.statusMessage === "saved") {
            onSaved();
            onClose();
        } else {
            setError((res as { statusMessage?: string })?.statusMessage ?? "save failed");
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="bg-background rounded-lg border border-border shadow-xl w-full max-w-4xl h-[80vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="shrink-0 flex items-center gap-2 px-4 h-11 border-b border-border">
                    <span className="text-sm font-medium flex-1 truncate">
                        {t("yaml.title")}
                    </span>
                    <button
                        onClick={onClose}
                        title={t("common.close")}
                        className="p-1 rounded hover:bg-accent shrink-0"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-auto relative font-mono text-xs leading-5">
                    {yaml === null ? (
                        <div className="p-4 text-sm text-muted-foreground">
                            {error || t("common.loading")}
                        </div>
                    ) : (
                        <div className="relative min-h-full">
                            <pre
                                ref={preRef}
                                aria-hidden
                                className={cn(
                                    "absolute inset-0 pointer-events-none overflow-hidden p-3 m-0 whitespace-pre-wrap break-all",
                                    error && "opacity-60"
                                )}
                                dangerouslySetInnerHTML={{ __html: html }}
                            />
                            <textarea
                                value={yaml ?? ""}
                                onChange={(e) => {
                                    setYaml(e.target.value);
                                    setError("");
                                }}
                                onScroll={(e) => {
                                    if (preRef.current)
                                        preRef.current.scrollTop = e.currentTarget.scrollTop;
                                }}
                                spellCheck={false}
                                className={cn(
                                    "relative w-full min-h-full resize-none bg-transparent p-3 m-0 outline-none whitespace-pre-wrap break-all",
                                    "text-transparent caret-foreground selection:bg-primary/30"
                                )}
                            />
                        </div>
                    )}
                </div>

                {error && (
                    <div className="shrink-0 px-4 py-2 text-xs text-destructive border-t border-border">
                        {error}
                    </div>
                )}

                <div className="shrink-0 flex items-center justify-between gap-2 px-4 h-12 border-t border-border">
                    <button
                        onClick={onClose}
                        className="text-xs rounded-md border border-input bg-background px-3 py-1.5 hover:bg-accent"
                    >
                        {t("common.close")}
                    </button>
                    <button
                        onClick={confirm}
                        disabled={yaml === null || saving}
                        className="text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 disabled:opacity-50"
                    >
                        {t("yaml.confirm")}
                    </button>
                </div>
            </div>
        </div>
    );
}
