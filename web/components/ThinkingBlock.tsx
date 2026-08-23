"use client";

import { useEffect, useRef, useState } from "react";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * ThinkingBlock —— 模型的思考过程展示。
 * 浅色小字体，可折叠，默认折叠。带计时器：从首段思考内容到达开始计时，
 * 到 thinking 结束（content 开始输出）或 30s 后停止（防泄漏）。
 */
export function ThinkingBlock({
    content,
    finished,
}: {
    content: string;
    /** 思考已结束：模型已输出正式内容（assistant text）或本回合结束 */
    finished?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const startRef = useRef<number | null>(null);
    const rafRef = useRef<number | null>(null);
    const stoppedRef = useRef(false);

    // 首段内容到达时记录开始时间
    if (content && startRef.current === null) {
        startRef.current = Date.now();
    }

    // 计时器：每 100ms 更新显示时长；finished 或超 30s 停止
    useEffect(() => {
        if (!content) return;
        const tick = () => {
            if (startRef.current === null || stoppedRef.current) return;
            const e = (Date.now() - startRef.current) / 1000;
            if (finished || e >= 30) {
                stoppedRef.current = true;
                setElapsed(finished ? Math.min(e, 30) : 30);
                return;
            }
            setElapsed(e);
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    }, [content, finished]);

    if (!content) return null;

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="flex items-center gap-1.5 px-1.5 py-0.5 w-full text-left rounded hover:bg-muted/30">
                <span className="font-mono text-muted-foreground text-[10px]">
                    {open ? "▾" : "▸"}
                </span>
                <span className="text-[11px] text-muted-foreground italic">
                    思考
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
