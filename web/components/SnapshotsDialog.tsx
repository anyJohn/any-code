"use client";

import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api";

interface Snapshot {
    id: string;
    label: string;
    ts: number;
}

/**
 * SnapshotsDialog —— 快照回滚（AR-4）。
 * 列出当前工作区的 shadow-git 快照（新→旧），选择时点回滚。
 * 回滚是危险操作：二次确认（点击"回滚"→ 变"确认回滚"再点执行）。
 * 语义：恢复该时点已跟踪文件；快照之后新建的未跟踪文件保留。
 */
export function SnapshotsDialog({
    projectKey,
    onClose,
}: {
    projectKey: string;
    onClose: () => void;
}) {
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [gitAvailable, setGitAvailable] = useState(true);
    const [loading, setLoading] = useState(true);
    const [armed, setArmed] = useState<string | null>(null); // 待二次确认的 id
    const [rolling, setRolling] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        apiJson<{ gitAvailable: boolean; snapshots: Snapshot[] }>(
            `/api/workspaces/${projectKey}/snapshots`
        ).then((res) => {
            if (res) {
                setSnapshots(res.snapshots ?? []);
                setGitAvailable(res.gitAvailable);
            } else {
                setError("加载快照失败");
            }
            setLoading(false);
        });
    }, [projectKey]);

    const rollback = async (id: string) => {
        setRolling(true);
        try {
            const res = await fetch(
                `/api/workspaces/${projectKey}/snapshots/rollback`,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ id }),
                }
            );
            if (res.ok) {
                onClose();
            } else {
                const j = (await res.json().catch(() => ({}))) as {
                    statusMessage?: string;
                };
                setError(j.statusMessage ?? "回滚失败");
                setRolling(false);
                setArmed(null);
            }
        } catch {
            setError("网络错误，回滚失败");
            setRolling(false);
            setArmed(null);
        }
    };

    const fmt = (ts: number) =>
        new Date(ts).toLocaleString("zh-CN", { hour12: false });

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>回滚工作区到快照</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto py-1">
                    {loading && (
                        <p className="text-sm text-muted-foreground">加载中…</p>
                    )}
                    {!loading && error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                    {!loading && !error && !gitAvailable && (
                        <p className="text-sm text-muted-foreground">
                            本机未安装 git，快照功能不可用。
                        </p>
                    )}
                    {!loading && !error && gitAvailable && snapshots.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                            暂无快照——agent 执行写类操作时会自动创建。
                        </p>
                    )}
                    {!loading &&
                        gitAvailable &&
                        snapshots.map((s, i) => (
                            <div
                                key={s.id}
                                className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
                            >
                                <span className="min-w-0 flex flex-col">
                                    <span className="truncate text-sm">
                                        {s.label}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground font-mono">
                                        {fmt(s.ts)} · {s.id.slice(0, 8)}
                                        {i === 0 ? " · 最新" : ""}
                                    </span>
                                </span>
                                <Button
                                    size="sm"
                                    variant={
                                        armed === s.id ? "destructive" : "outline"
                                    }
                                    disabled={rolling}
                                    className="shrink-0 h-7 text-xs"
                                    onClick={() => {
                                        if (armed === s.id) {
                                            void rollback(s.id);
                                        } else {
                                            setArmed(s.id);
                                        }
                                    }}
                                >
                                    {armed === s.id
                                        ? rolling
                                            ? "回滚中…"
                                            : "确认回滚"
                                        : "回滚"}
                                </Button>
                            </div>
                        ))}
                    {!loading && gitAvailable && snapshots.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                            回滚恢复该时点已跟踪的文件；快照之后新建且未被跟踪的文件会保留。回滚前请确认已保存手头工作。
                        </p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
