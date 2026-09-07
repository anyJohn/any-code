"use client";

import { useState } from "react";
import { apiJson } from "@/lib/api";
import { useAppSelector } from "@/hooks/useRedux";
import { selectWorkspace } from "@/store/workspaceSlice";
import type { WorkspaceWithSessions } from "@/lib/sseEvents";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export interface JobInfo {
    id: string;
    command: string;
    intent?: string;
    sessionId?: string;
    output: string;
    truncated: boolean;
    done: boolean;
    exitCode: number | null;
    startedAt: number;
}

/**
 * RuntimeTab（SPEC-038 评审定稿）：Workspace 级运行中心——第四 tab。
 * 聊天是 Session 的，进程是 Workspace 的：卡片显示状态/命令/来源会话/时长/日志/停止。
 */
export function RuntimeTab({
    jobs,
    onKilled,
    projectKey,
}: {
    jobs: JobInfo[];
    /** 终止成功后通知父级刷新 */
    onKilled?: () => void;
    projectKey: string;
}) {
    const { t } = useT();
    const { workspaces } = useAppSelector(selectWorkspace) as unknown as { workspaces: WorkspaceWithSessions[] };
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [armed, setArmed] = useState<string | null>(null);

    // sessionId → 会话标题（"来自哪个对话"）
    const titleBySession = new Map<string, string>();
    for (const w of workspaces) {
        for (const s of w.sessions ?? []) {
            if (s.id && s.title) titleBySession.set(s.id, s.title);
        }
    }

    const kill = async (id: string) => {
        await apiJson(`/api/workspaces/${projectKey}/jobs/${id}/kill`, { method: "POST" });
        setArmed(null);
        onKilled?.();
    };

    const running = jobs.filter((j) => !j.done).length;

    return (
        <div className="h-full overflow-y-auto">
            <div className="w-full max-w-3xl mx-auto px-4 py-3 flex flex-col gap-3">
                {jobs.length === 0 && (
                    <div className="py-16 text-center text-sm text-muted-foreground">
                        {t("runtime.empty")}
                    </div>
                )}
                {jobs.map((j) => {
                    const sessionTitle = j.sessionId
                        ? titleBySession.get(j.sessionId)
                        : undefined;
                    return (
                        <div
                            key={j.id}
                            className="rounded-lg border border-border overflow-hidden"
                        >
                            <div className="flex items-center gap-2.5 px-3 py-2">
                                {j.done ? (
                                    <span
                                        className={cn(
                                            "shrink-0 size-2 rounded-full",
                                            j.exitCode === 0
                                                ? "bg-emerald-500"
                                                : "bg-destructive"
                                        )}
                                    />
                                ) : (
                                    <span className="shrink-0 size-2 rounded-full bg-amber-500 animate-pulse" />
                                )}
                                <span className="font-mono text-sm text-foreground truncate min-w-0 flex-1">
                                    {j.intent || j.command}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                    {j.done
                                        ? t("runtime.exited", { code: j.exitCode ?? "-" })
                                        : t("runtime.runningFor", {
                                              secs: Math.round(
                                                  (Date.now() - j.startedAt) / 1000
                                              ),
                                          })}
                                </span>
                                {!j.done && (
                                    <button
                                        onClick={() => {
                                            if (armed === j.id) void kill(j.id);
                                            else {
                                                setArmed(j.id);
                                                setTimeout(
                                                    () =>
                                                        setArmed((a) =>
                                                            a === j.id ? null : a
                                                        ),
                                                    3000
                                                );
                                            }
                                        }}
                                        className={cn(
                                            "shrink-0 p-1 rounded hover:bg-accent",
                                            armed === j.id
                                                ? "text-destructive"
                                                : "text-muted-foreground"
                                        )}
                                        title={t("runtime.stop")}
                                    >
                                        {armed === j.id ? (
                                            <span className="px-0.5 text-xs">
                                                {t("runtime.confirmStop")}
                                            </span>
                                        ) : (
                                            <X className="size-3.5" />
                                        )}
                                    </button>
                                )}
                            </div>
                            <div className="px-3 pb-2 flex flex-col gap-1">
                                {j.command !== (j.intent || j.command) && (
                                    <div className="font-mono text-xs text-muted-foreground truncate">
                                        {j.command}
                                    </div>
                                )}
                                {sessionTitle && (
                                    <div className="text-xs text-muted-foreground">
                                        {t("runtime.fromSession", { title: sessionTitle })}
                                    </div>
                                )}
                                <button
                                    onClick={() =>
                                        setExpanded((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(j.id)) next.delete(j.id);
                                            else next.add(j.id);
                                            return next;
                                        })
                                    }
                                    className="text-xs text-primary text-left w-fit hover:underline"
                                >
                                    {expanded.has(j.id)
                                        ? t("runtime.hideLog")
                                        : t("runtime.showLog")}
                                </button>
                                {expanded.has(j.id) && (
                                    <pre className="rounded bg-muted/50 p-2 max-h-64 overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap break-all">
                                        {j.output || t("runtime.noLog")}
                                        {j.truncated && `\n…${t("runtime.truncated")}`}
                                    </pre>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
