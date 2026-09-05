"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

interface SnapshotInfo {
    id: string;
    label: string;
    ts: number;
    /** 工作树相对该快照的变更文件数（domain list 计算） */
    changes: number;
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
 * patch 逐行解析：从 @@ -a,b +c,d @@ 头推导每行的旧行号/新行号（diff 视图行号
 * gutter 用）。hunk 头/文件头等元行行号为 null。
 */
export interface PatchRow {
    oldNo: number | null;
    newNo: number | null;
    text: string;
}

export function parsePatch(patch: string): PatchRow[] {
    const rows: PatchRow[] = [];
    let oldNo = 0;
    let newNo = 0;
    for (const line of patch.split("\n")) {
        if (line.startsWith("@@")) {
            const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
            if (m) {
                oldNo = parseInt(m[1], 10);
                newNo = parseInt(m[2], 10);
            }
            rows.push({ oldNo: null, newNo: null, text: line });
        } else if (line.startsWith("+")) {
            rows.push({ oldNo: null, newNo, text: line });
            newNo++;
        } else if (line.startsWith("-")) {
            rows.push({ oldNo, newNo: null, text: line });
            oldNo++;
        } else if (line.startsWith("\\")) {
            // "\ No newline at end of file"：元行，不推进行号
            rows.push({ oldNo: null, newNo: null, text: line });
        } else if (
            line.startsWith("diff ") ||
            line.startsWith("index ") ||
            line.startsWith("--- ") ||
            line.startsWith("+++ ")
        ) {
            rows.push({ oldNo: null, newNo: null, text: line });
        } else {
            // 上下文行（含空行 " "）
            rows.push({ oldNo, newNo, text: line });
            oldNo++;
            newNo++;
        }
    }
    return rows;
}

/**
 * ChangesTab（SPEC-036 B-007 变更 tab）：工作树相对所选快照的变更。
 * 快照下拉（仅列出有变更的快照，用户反馈 2026-09-06）+ 文件列表（点击过滤
 * patch）+ 统一 diff 视图（行号 gutter + +/- 行全宽着色）。
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
            const all = Array.isArray(data?.snapshots) ? data.snapshots : [];
            // 只列有变更的快照（全靠后无变更 → 显示"无"占位）
            const changed = all.filter((s) => (s.changes ?? 0) > 0);
            setSnapshots(changed);
            if (!selected && changed.length) setSelected(changed[0].id);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectKey]);

    const loadDiff = useCallback(
        async (id: string, path: string | null) => {
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
        },
        [projectKey]
    );

    useEffect(() => {
        if (selected) void loadDiff(selected, activeFile);
    }, [selected, activeFile, loadDiff]);

    const patchRows = useMemo(
        () => (diff?.patch ? parsePatch(diff.patch) : []),
        [diff]
    );

    if (!gitAvailable) {
        return <Empty text={t("changes.gitUnavailable")} />;
    }
    return (
        <div className="h-full overflow-y-auto">
            <div className="w-full max-w-3xl mx-auto px-4 py-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    {snapshots.length === 0 ? (
                        // 空状态显示"无"（细节反馈 2026-09-06）
                        <span className="text-xs rounded-md border border-input bg-muted/40 px-2 py-1 text-muted-foreground">
                            {t("changes.noneChanged")}
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

                {patchRows.length > 0 && (
                    <div className="rounded-md border border-border bg-muted/40 overflow-x-auto text-xs leading-relaxed font-mono">
                        <div className="min-w-max">
                            {patchRows.map((r, i) => {
                                const added = r.text.startsWith("+") && r.oldNo === null;
                                const removed = r.text.startsWith("-") && r.newNo === null;
                                return (
                                    <div
                                        key={i}
                                        className={cn(
                                            "flex",
                                            added &&
                                                "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                            removed &&
                                                "bg-destructive/10 text-destructive"
                                        )}
                                    >
                                        <span className="select-none w-12 shrink-0 text-right pr-2 text-muted-foreground/50 sticky left-0 bg-muted/40">
                                            {r.oldNo ?? ""}
                                        </span>
                                        <span className="select-none w-12 shrink-0 text-right pr-2 text-muted-foreground/50 sticky left-12 bg-muted/40">
                                            {r.newNo ?? ""}
                                        </span>
                                        <span className="pr-4 whitespace-pre">
                                            {r.text || " "}
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
