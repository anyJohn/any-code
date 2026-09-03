"use client";

import { useEffect, useState } from "react";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

/**
 * ThinkingBlock —— 模型的思考过程展示。
 * 浅色小字体，可折叠，默认折叠。
 * 计时：从事件时间戳推导（startedAt = 首个 Thinking 事件，endedAt = thinking 后首个
 * 实质事件）——与组件挂载时刻无关。中途退出再进入（重放/历史恢复）显示的是真实
 * 时长；已结束的思考纯静态渲染，不装任何定时器。
 */
export function ThinkingBlock({
    content,
    finished,
    startedAt,
    endedAt,
    live,
}: {
    content: string;
    /** 思考已结束：模型已输出正式内容（assistant text）或本回合结束 */
    finished?: boolean;
    /** 思考开始时刻（首个 Thinking 事件 timestamp） */
    startedAt?: number;
    /** 思考结束时刻（thinking 后首个实质事件 timestamp）；finished 时应有值 */
    endedAt?: number;
    /** 会话运行中：false 时绝不跳表（终态缺失的思考按静态处理） */
    live?: boolean;
}) {
    const { t } = useT();
    const [open, setOpen] = useState(false);
    // 活跃思考的"现在"；finished 或非 live 时不更新（纯静态，无定时器）
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!content || finished || !live) return;
        const id = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(id);
    }, [content, finished, live]);

    if (!content) return null;

    // 时长推导：结束戳优先（精确且静态）；进行中用 now；
    // 孤儿开思考（非 live 且无结束戳——理论上已被终态闭合，兜底）显示 0.0s
    const end = endedAt ?? (finished ? undefined : live ? now : undefined);
    const elapsed =
        startedAt && end ? Math.max(0, (end - startedAt) / 1000) : 0;

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="flex items-center gap-1.5 px-1.5 py-0.5 w-full text-left rounded hover:bg-muted/30">
                <span className="font-mono text-muted-foreground text-[10px]">
                    {open ? "▾" : "▸"}
                </span>
                <span className="text-[11px] text-muted-foreground italic">
                    {t("thinkingBlock.label")}
                </span>
                <span className="text-[10px] text-muted-foreground/60 tabular-nums font-mono">
                    {elapsed.toFixed(1)}s
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 ml-4 border-l-2 border-muted pl-3">
                <pre
                    className={cn(
                        "text-muted-foreground/80 whitespace-pre-wrap break-words overflow-y-auto max-h-60",
                        "text-[11px] leading-relaxed"
                    )}
                >
                    {content}
                </pre>
            </CollapsibleContent>
        </Collapsible>
    );
}
