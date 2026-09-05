"use client";

import { useMemo, useState } from "react";
import type { AgentEvent, PlanningEventData } from "@/lib/sseEvents";
import { ChevronDown, ChevronRight, ListTodo } from "lucide-react";
import { useT } from "@/i18n";

/**
 * TodoPanel（SPEC-036 B-012）：渲染本轮任务的 plan 模式计划（Planning 事件，per-run
 * 生命周期不持久化）。取最近一条 User 之后、round 最大的 Planning。
 */
export function TodoPanel({ events }: { events: AgentEvent[] }) {
    const { t } = useT();
    const [open, setOpen] = useState(true);

    const plan = useMemo(() => {
        // 最近一条 User 之后的事件 = 本轮 run
        let lastUser = -1;
        for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].type === "User") {
                lastUser = i;
                break;
            }
        }
        let latest: PlanningEventData | null = null;
        for (let i = lastUser + 1; i < events.length; i++) {
            const e = events[i];
            if (e.type === "Planning") {
                const d = e.data as PlanningEventData;
                if (!latest || d.round >= latest.round) latest = d;
            }
        }
        return latest;
    }, [events]);

    if (!plan || !plan.plan.trim()) return null;

    return (
        <div className="shrink-0 w-full max-w-3xl mx-auto px-4 pt-2">
            <div className="rounded-lg border border-border overflow-hidden">
                <button
                    onClick={() => setOpen((v) => !v)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/60"
                >
                    {open ? (
                        <ChevronDown className="size-3.5" />
                    ) : (
                        <ChevronRight className="size-3.5" />
                    )}
                    <ListTodo className="size-3.5" />
                    <span>{t("todo.title")}</span>
                    <span className="ml-auto font-mono text-[10px]">
                        {t("todo.round", { round: plan.round })}
                    </span>
                </button>
                {open && (
                    <div className="px-3 py-2 text-xs whitespace-pre-wrap border-t border-border bg-muted/30 max-h-60 overflow-y-auto">
                        {plan.plan.trim()}
                    </div>
                )}
            </div>
        </div>
    );
}
