"use client";

import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    ModalFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";

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
    const { t } = useT();
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
                setError(t("snapshots.loadFailed"));
            }
            setLoading(false);
        });
    }, [projectKey, t]);

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
                setError(j.statusMessage ?? t("snapshots.rollbackFailed"));
                setRolling(false);
                setArmed(null);
            }
        } catch {
            setError(t("snapshots.networkError"));
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
                    <DialogTitle>{t("snapshots.title")}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto py-1">
                    {loading && (
                        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                    )}
                    {!loading && error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                    {!loading && !error && !gitAvailable && (
                        <p className="text-sm text-muted-foreground">
                            {t("snapshots.gitUnavailable")}
                        </p>
                    )}
                    {!loading && !error && gitAvailable && snapshots.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                            {t("snapshots.empty")}
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
                                        {i === 0 ? ` · ${t("snapshots.latest")}` : ""}
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
                                            ? t("snapshots.rolling")
                                            : t("snapshots.confirmRollback")
                                        : t("snapshots.rollback")}
                                </Button>
                            </div>
                        ))}
                    {!loading && gitAvailable && snapshots.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                            {t("snapshots.rollbackHint")}
                        </p>
                    )}
                </div>
                {/* DesignSpec 弹窗规范：footer 至少有 close（左）；回滚是行内操作不入 footer */}
                <ModalFooter onClose={onClose} closeLabel={t("common.close")} />
            </DialogContent>
        </Dialog>
    );
}
