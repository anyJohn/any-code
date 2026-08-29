"use client";

import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatToolCall, toolHidesResult, toolResult } from "@/lib/renderItems";
import type { AgentEvent } from "@/lib/sseEvents";

/**
 * ToolRow —— 单条工具调用摘要 + 可折叠展开结果。
 * 联网工具（web_search/web_fetch）回显即全部：只显示"搜了什么 / 抓了哪个 url"，不展结果内容。
 */
export function ToolRow({
    event,
    open,
    onToggle,
    compact,
}: {
    event: Extract<AgentEvent, { type: "Tool" }>;
    open: boolean;
    onToggle: () => void;
    compact?: boolean;
}) {
    const name = event.data?.name ?? "";
    const rowCls = cn(
        "flex items-center gap-1 w-full text-left",
        compact ? "px-1 py-0.5" : "px-1.5 py-1"
    );
    const textCls = cn(
        "font-mono text-muted-foreground truncate",
        compact ? "text-[10px]" : "text-[11px]"
    );
    if (toolHidesResult(name)) {
        return (
            <div className={cn(rowCls, "rounded hover:bg-muted/50")}>
                <span className={textCls}>{formatToolCall(event.data)}</span>
            </div>
        );
    }
    return (
        <Collapsible open={open} onOpenChange={onToggle}>
            <CollapsibleTrigger
                className={cn(rowCls, "rounded hover:bg-muted/50")}
            >
                <span
                    className={cn(
                        "font-mono text-muted-foreground",
                        compact ? "text-[10px]" : "text-[11px]"
                    )}
                >
                    {open ? "▾" : "▸"}
                </span>
                <span className={textCls}>{formatToolCall(event.data)}</span>
            </CollapsibleTrigger>
            <CollapsibleContent
                className={cn("mt-1 ml-4 border-l border-border pl-3")}
            >
                <pre
                    className={cn(
                        "text-muted-foreground whitespace-pre-wrap break-words overflow-y-auto max-h-60",
                        compact ? "text-[11px]" : "text-xs max-h-80"
                    )}
                >
                    {toolResult(event.data)}
                </pre>
            </CollapsibleContent>
        </Collapsible>
    );
}
