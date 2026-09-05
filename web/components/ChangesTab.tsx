"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

interface SnapshotInfo {
    id: string;
    label: string;
    ts: number;
}

interface DiffResult {
    files: { path: string; status: string }[];
    patch: string;
}

const STATUS_COLOR: Record<string, string> = {
    A: "text-emerald-500",
    M: "text-amber-500",
    D: "text-destructive",
    R: "text-blue-500",
};

/**
 * ChangesTab（SPEC-036 B-007 变更 tab）：工作树相对所选快照的变更。
 * 快照下拉（缺省最新）+ 文件列表（点击过滤 patch）+ 统一 diff 视图（+/- 行着色）。
 */
export function ChangesTab({ projectKey }: { projectKey: string }) {
    const { t } = useT();
    const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
    const [gitAvailable, setGitAvailable] = useState(true);
    const [selected, setSelected] = useState<string>("");
    const [diff, setDiff] = useState<DiffResult | null>(null);
    const [error, setError] = useState("");
    const [activeFile, setActiveFile] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void apiJson<{ gitAvailable: boolean; snapshots: SnapshotInfo[] }>(
            `/api/workspaces/${projectKey}/snapshots`
        ).then((data) => {
            if (cancelled || !data) return;
            setGitAvailable(data.gitAvailable);
            setSnapshots(Array.isArray(data?.snapshots) ? data.snapshots : []);
            if (!selected && data.snapshots?.length) setSelected(data.snapshots[0].id);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectKey]);

    const loadDiff = useCallback(async (id: string, path: string | null) => {
        setError("");
        const q = path ? `?path=${encodeURIComponent(path)}` : "";
        const data = await apiJson<DiffResult | { statusMessage: string }>(
            `/api/workspaces/${projectKey}/snapshots/${id}/diff${q}`
        );
        if (data && "statusMessage" in data) {
            setError(data.statusMessage);
            setDiff(null);
        } else {
            setDiff(data ?? { files: [], patch: "" });
        }
    }, [projectKey]);

    useEffect(() => {
        if (selected) void loadDiff(selected, activeFile);
    }, [selected, activeFile, loadDiff]);

    const patchLines = useMemo(() => diff?.patch.split("\n") ?? [], [diff]);

    if (!gitAvailable) {
        return <Empty text={t("changes.gitUnavailable")} />;
    }
    return (
        <div className="h-full overflow-y-auto">
            <div className="w-full max-w-3xl mx-auto px-4 py-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    {snapshots.length === 0 ? (
                        // 空状态下拉显示"无"（细节反馈 2026-09-06）
                        <span className="text-xs rounded-md border border-input bg-muted/40 px-2 py-1 text-muted-foreground">
                            {t("changes.noSnapshots")}
                        </span>
                    ) : (
                        <select
                            value={selected}
                            onChange={(e) => {
                                setSelected(e.target.value);
                                setActiveFile(null);
                            }}
                            className="text-xs rounded-md border border-input bg-background px-2 py-1 max-w-[60%]"
                        >
                            {snapshots.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {snapshotOptionLabel(s)}
                                </option>
                            ))}
                        </select>
                    )}
                    {activeFile && (
                        <button
                            onClick={() => setActiveFile(null)}
                            className="text-xs text-muted-foreground hover:text-underline"
                        >
                            {t("changes.showAll")}
                        </button>
                    )}
                </div>

                {error && (
                    <div className="text-xs text-destructive">{error}</div>
                )}

                {diff && diff.files.length === 0 && (
                    <Empty text={t("changes.empty")} />
                )}

                {diff && diff.files.length > 0 && (
                    <div className="flex flex-col gap-1">
                        {diff.files.map((f) => (
                            <button
                                key={f.path}
                                onClick={() =>
                                    setActiveFile(f.path === activeFile ? null : f.path)
                                }
                                className={cn(
                                    "flex items-center gap-2 text-left text-xs rounded px-2 py-1 hover:bg-accent",
                                    f.path === activeFile && "bg-accent"
                                )}
                            >
                                <span
                                    className={cn(
                                        "font-mono font-semibold shrink-0",
                                        STATUS_COLOR[f.status[0]] ?? ""
                                    )}
                                >
                                    {f.status[0]}
                                </span>
                                <span className="font-mono truncate">{f.path}</span>
                            </button>
                        ))}
                    </div>
                )}

                {patchLines.length > 0 && (
                    <pre className="rounded-md border border-border bg-muted/40 overflow-x-auto p-3 text-xs leading-relaxed font-mono">
                        {patchLines.map((line, i) => (
                            <div
                                key={i}
                                className={cn(
                                    line.startsWith("+") && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                    line.startsWith("-") && "bg-destructive/10 text-destructive"
                                )}
                            >
                                {line || " "}
                            </div>
                        ))}
                    </pre>
                )}
            </div>
        </div>
    );
}

function Empty({ text }: { text: string }) {
    return (
        <div className="py-16 text-center text-sm text-muted-foreground">
            {text}
        </div>
    );
}

/**
 * 下拉选项 label：时间 + 命令摘要前几个字符 + 省略号（用户反馈：完整 label
 * 过长导致下拉框卡且巨长）。
 */
function snapshotOptionLabel(s: SnapshotInfo): string {
    const time = new Date(s.ts).toLocaleTimeString();
    const brief =
        s.label.length > 14 ? s.label.slice(0, 14) + "…" : s.label;
    return `${time} · ${brief}`;
}
