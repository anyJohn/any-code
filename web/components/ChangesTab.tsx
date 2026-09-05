"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import hljs from "highlight.js/lib/common";
import { ChevronDown, ChevronLeft } from "lucide-react";

interface SnapshotInfo {
    id: string;
    /** 触发快照的命令（domain 存事实，展示 label 在此拼接） */
    command: string;
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
 * patch 逐行解析：从 @@ -a,b +c,d @@ 头推导每行的旧行号/新行号。hunk 头等元行行号为 null。
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
            rows.push({ oldNo: null, newNo: null, text: line });
        } else if (
            line.startsWith("diff ") ||
            line.startsWith("index ") ||
            line.startsWith("--- ") ||
            line.startsWith("+++ ")
        ) {
            rows.push({ oldNo: null, newNo: null, text: line });
        } else {
            rows.push({ oldNo, newNo, text: line });
            oldNo++;
            newNo++;
        }
    }
    return rows;
}

/** 整段 patch 按文件切分（diff --git a/X b/Y 为界，取 b/ 侧路径） */
export function splitPatch(patch: string): Map<string, string> {
    const map = new Map<string, string>();
    let path = "";
    let lines: string[] = [];
    const flush = () => {
        if (path) map.set(path, lines.join("\n"));
    };
    for (const line of patch.split("\n")) {
        if (line.startsWith("diff --git ")) {
            flush();
            const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
            path = m ? m[2] : line;
            lines = [line];
        } else if (path) {
            lines.push(line);
        }
    }
    flush();
    return map;
}

function DiffView({ patch }: { patch: string }) {
    const rows = useMemo(() => parsePatch(patch), [patch]);
    return (
        <div className="overflow-x-auto border-t border-border bg-muted/30 text-xs font-mono leading-relaxed">
            <div className="min-w-max py-1">
                {rows.map((r, i) => {
                    const added = r.text.startsWith("+") && r.oldNo === null;
                    const removed = r.text.startsWith("-") && r.newNo === null;
                    return (
                        <div
                            key={i}
                            className={cn(
                                "flex",
                                added &&
                                    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                removed && "bg-destructive/10 text-destructive"
                            )}
                        >
                            <span className="select-none w-12 shrink-0 text-right pr-2 text-muted-foreground/50 sticky left-0 bg-muted/30">
                                {r.oldNo ?? ""}
                            </span>
                            <span className="select-none w-12 shrink-0 text-right pr-2 text-muted-foreground/50 sticky left-12 bg-muted/30">
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
    );
}

/**
 * ChangesTab（SPEC-036 B-007 变更 tab）：工作树相对所选快照的变更。
 * 快照下拉（仅列有变更的）+ 高亮完整命令条 + 按文件手风琴（默认收起，点开展开该文件 diff）。
 */
export function ChangesTab({ projectKey }: { projectKey: string }) {
    const { t } = useT();
    const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
    const [gitAvailable, setGitAvailable] = useState(true);
    const [selected, setSelected] = useState<string>("");
    const [diff, setDiff] = useState<DiffResult | null>(null);
    const [error, setError] = useState("");
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
        let cancelled = false;
        void apiJson<{ gitAvailable: boolean; snapshots: SnapshotInfo[] }>(
            `/api/workspaces/${projectKey}/snapshots`
        ).then((data) => {
            if (cancelled || !data) return;
            setGitAvailable(data.gitAvailable);
            const all = Array.isArray(data?.snapshots) ? data.snapshots : [];
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
        async (id: string) => {
            setError("");
            const data = await apiJson<DiffResult | { statusMessage: string }>(
                `/api/workspaces/${projectKey}/snapshots/${id}/diff`
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
        if (selected) void loadDiff(selected);
    }, [selected, loadDiff]);

    const filePatches = useMemo(
        () => (diff?.patch ? splitPatch(diff.patch) : new Map<string, string>()),
        [diff]
    );

    const selectedSnapshot = snapshots.find((s) => s.id === selected) ?? null;
    const commandHtml = useMemo(() => {
        if (!selectedSnapshot) return "";
        try {
            return hljs.highlight(selectedSnapshot.command, {
                language: "bash",
                ignoreIllegals: true,
            }).value;
        } catch {
            return "";
        }
    }, [selectedSnapshot]);

    const toggleFile = (path: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });

    if (!gitAvailable) {
        return <Empty text={t("changes.gitUnavailable")} />;
    }
    return (
        <div className="h-full overflow-y-auto">
            <div className="w-full max-w-3xl mx-auto px-4 py-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    {snapshots.length === 0 ? (
                        <span className="text-xs rounded-md border border-input bg-muted/40 px-2 py-1 text-muted-foreground">
                            {t("changes.noneChanged")}
                        </span>
                    ) : (
                        <select
                            value={selected}
                            onChange={(e) => {
                                setSelected(e.target.value);
                                setExpanded(new Set());
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
                </div>

                {selectedSnapshot && (
                    <pre
                        className="rounded-md border border-border bg-muted/60 text-foreground overflow-x-auto px-3 py-2 text-xs font-mono"
                        dangerouslySetInnerHTML={{ __html: commandHtml }}
                    />
                )}

                {error && (
                    <div className="text-xs text-destructive">{error}</div>
                )}

                {diff && diff.files.length === 0 && (
                    <Empty text={t("changes.empty")} />
                )}

                {diff && diff.files.length > 0 && (
                    <div className="flex flex-col gap-2">
                        {diff.files.map((f) => {
                            const open = expanded.has(f.path);
                            return (
                                <div
                                    key={f.path}
                                    className="rounded-md border border-border overflow-hidden"
                                >
                                    <button
                                        onClick={() => toggleFile(f.path)}
                                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent/60"
                                    >
                                        {open ? (
                                            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                                        ) : (
                                            <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground" />
                                        )}
                                        <span
                                            className={cn(
                                                "font-mono font-semibold shrink-0",
                                                STATUS_COLOR[f.status[0]] ?? ""
                                            )}
                                        >
                                            {f.status[0]}
                                        </span>
                                        <span className="font-mono truncate flex-1 min-w-0">
                                            {f.path}
                                        </span>
                                    </button>
                                    {open && (
                                        <DiffView
                                            patch={filePatches.get(f.path) ?? ""}
                                        />
                                    )}
                                </div>
                            );
                        })}
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

/** 下拉选项 label（interface 层拼接）：时间 + 命令摘要前几个字符 + 省略号 */
function snapshotOptionLabel(s: SnapshotInfo): string {
    const time = new Date(s.ts).toLocaleTimeString();
    const brief =
        s.command.length > 14 ? s.command.slice(0, 14) + "…" : s.command;
    return `${time} · ${brief}`;
}
