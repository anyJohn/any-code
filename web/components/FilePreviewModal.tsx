"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import hljs from "highlight.js/lib/common";
import { X, Plus } from "lucide-react";

const EXT_LANG: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    mjs: "javascript", cjs: "javascript", py: "python", rs: "rust", go: "go",
    java: "java", kt: "kotlin", c: "c", h: "c", cpp: "cpp", hpp: "cpp",
    cs: "csharp", rb: "ruby", php: "php", sh: "bash", bash: "bash",
    zsh: "bash", fish: "fish", ps1: "powershell", html: "xml", xml: "xml",
    css: "css", scss: "scss", less: "less", json: "json", yaml: "yaml",
    yml: "yaml", toml: "ini", ini: "ini", sql: "sql", md: "markdown",
    lua: "lua", swift: "swift", dart: "dart", vim: "vim", dockerfile: "dockerfile",
    makefile: "makefile", r: "r", pl: "perl", scala: "scala", ex: "elixir",
    exs: "elixir", hs: "haskell", clj: "clojure", erl: "erlang", zig: "zig",
    graphql: "graphql", gql: "graphql", vue: "xml", svelte: "xml",
};

function langOf(path: string): string | undefined {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const lang = EXT_LANG[ext];
    return lang && hljs.getLanguage(lang) ? lang : undefined;
}

/**
 * FilePreviewModal（SPEC-036 B-009/B-010）：只读文件预览。
 * 行号 gutter + 按扩展名高亮（hljs 逐行，超长行/多行字符串可能有细微着色损失）；
 * 点选起始行再点结束行 → 添加 path:10-20 引用；不划选 = 整文件引用。
 * >1MB（前端预检 400）与二进制文件服务端拒绝，展示占位说明。
 */
export function FilePreviewModal({
    projectKey,
    filePath,
    onClose,
    onAddReference,
}: {
    projectKey: string;
    filePath: string;
    onClose: () => void;
    onAddReference: (path: string, lines?: [number, number]) => void;
}) {
    const { t } = useT();
    const [content, setContent] = useState<string | null>(null);
    const [error, setError] = useState("");
    // 划选状态：null=未选；选了起始行等待第二次点击=结束行
    const [range, setRange] = useState<[number, number] | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        setContent(null);
        setError("");
        setRange(null);
        void apiJson<{ content: string } | { statusMessage: string }>(
            `/api/workspaces/${projectKey}/file?path=${encodeURIComponent(filePath)}`
        ).then((data) => {
            if (cancelled) return;
            if (data && "statusMessage" in data) {
                setError(
                    data.statusMessage === "binary file"
                        ? t("files.binary")
                        : data.statusMessage
                );
            } else if (data && "content" in data) {
                setContent(data.content);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [projectKey, filePath, t]);

    const lines = useMemo(() => (content ?? "").split("\n"), [content]);
    const lang = langOf(filePath);

    const highlighted = useMemo(() => {
        return lines.map((line) => {
            if (!lang || line.length > 2000) return null;
            try {
                return hljs.highlight(line, { language: lang, ignoreIllegals: true }).value;
            } catch {
                return null;
            }
        });
    }, [lines, lang]);

    const onLineClick = (idx: number) => {
        if (range === null) setRange([idx + 1, idx + 1]);
        else {
            const [start] = range;
            setRange(start <= idx + 1 ? [start, idx + 1] : [idx + 1, start]);
        }
    };

    const addRef = () => onAddReference(filePath, range === null ? undefined : range);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-background rounded-lg border border-border shadow-xl w-full max-w-4xl h-[80vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="shrink-0 flex items-center gap-2 px-4 h-11 border-b border-border">
                    <span className="font-mono text-sm truncate flex-1 min-w-0">
                        {filePath}
                    </span>
                    {range && (
                        <span className="text-xs text-primary shrink-0">
                            {t("files.selectedRange", {
                                start: range[0],
                                end: range[1],
                            })}
                        </span>
                    )}
                    <button
                        onClick={addRef}
                        disabled={!!error}
                        className="shrink-0 inline-flex items-center gap-1 text-xs rounded-md bg-primary text-primary-foreground px-2 py-1 disabled:opacity-50"
                    >
                        <Plus className="size-3" />
                        {range ? t("files.addRangeRef") : t("files.addWholeRef")}
                    </button>
                    <button
                        onClick={onClose}
                        title={t("common.close")}
                        className="p-1 rounded hover:bg-accent shrink-0"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                {error ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                        {error}
                    </div>
                ) : (
                    <div ref={scrollRef} className="flex-1 overflow-auto">
                        <div className="min-w-max text-xs font-mono leading-5">
                            {lines.map((line, i) => {
                                const n = i + 1;
                                const inRange =
                                    range && n >= range[0] && n <= range[1];
                                return (
                                    <div
                                        key={i}
                                        onClick={() => onLineClick(i)}
                                        className={cn(
                                            "flex cursor-pointer hover:bg-accent/60",
                                            inRange && "bg-primary/15"
                                        )}
                                    >
                                        <span className="select-none w-14 shrink-0 text-right pr-3 text-muted-foreground/60 sticky left-0 bg-background">
                                            {n}
                                        </span>
                                        <span className="pr-4 whitespace-pre">
                                            {highlighted[i] === null ? (
                                                line || " "
                                            ) : (
                                                <span
                                                    dangerouslySetInnerHTML={{
                                                        __html: highlighted[i] || "&nbsp;",
                                                    }}
                                                />
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
