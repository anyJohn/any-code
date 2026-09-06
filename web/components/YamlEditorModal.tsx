"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import { X } from "lucide-react";

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
    const gutterRef = useRef<HTMLDivElement>(null);

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

    /** textarea 是唯一滚动源——同步高亮层与行号栏 */
    const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
        const { scrollTop, scrollLeft } = e.currentTarget;
        if (preRef.current) {
            preRef.current.scrollTop = scrollTop;
            preRef.current.scrollLeft = scrollLeft;
        }
        if (gutterRef.current) gutterRef.current.scrollTop = scrollTop;
    };

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

                <div className="flex-1 min-h-0 overflow-hidden flex bg-muted/40">
                    {yaml === null ? (
                        <div className="p-4 text-sm text-muted-foreground">
                            {error || t("common.loading")}
                        </div>
                    ) : (
                        <>
                            {/* 行号栏：与代码区同行高，滚动随 textarea 同步 */}
                            <div
                                ref={gutterRef}
                                aria-hidden
                                className="shrink-0 w-12 overflow-hidden select-none bg-muted/70 text-muted-foreground text-right font-mono text-xs leading-5 py-3 border-r border-border"
                            >
                                {(yaml ?? "").split("\n").map((_, i) => (
                                    <div key={i}>{i + 1}</div>
                                ))}
                            </div>
                            <div className="relative flex-1 min-w-0">
                                <pre
                                    ref={preRef}
                                    aria-hidden
                                    className="absolute inset-0 m-0 overflow-hidden p-3 font-mono text-xs leading-5 text-foreground whitespace-pre"
                                    dangerouslySetInnerHTML={{ __html: html }}
                                />
                                <textarea
                                    value={yaml ?? ""}
                                    onChange={(e) => {
                                        setYaml(e.target.value);
                                        setError("");
                                    }}
                                    onScroll={syncScroll}
                                    spellCheck={false}
                                    className="absolute inset-0 resize-none bg-transparent p-3 font-mono text-xs leading-5 text-transparent caret-foreground outline-none whitespace-pre overflow-auto selection:bg-primary/30"
                                />
                            </div>
                        </>
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
