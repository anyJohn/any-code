"use client";

import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatToolCall, toolResult } from "@/lib/renderItems";
import type { AgentEvent } from "@/lib/sseEvents";

/**
 * ToolRow —— 单条工具调用摘要 + 可折叠展开结果。
 */
export function ToolRow({
    event,
    open,
    onToggle,
    compact,
}: {
    event: AgentEvent;
    open: boolean;
    onToggle: () => void;
    compact?: boolean;
}) {
    return (
        <Collapsible open={open} onOpenChange={onToggle}>
            <CollapsibleTrigger
                className={cn(
                    "flex items-center gap-1 w-full text-left rounded hover:bg-muted/50",
                    compact ? "px-1 py-0.5" : "px-1.5 py-1"
                )}
            >
                <span
                    className={cn(
                        "font-mono text-muted-foreground",
                        compact ? "text-[10px]" : "text-[11px]"
                    )}
                >
                    {open ? "▾" : "▸"}
                </span>
                <span
                    className={cn(
                        "font-mono text-muted-foreground truncate",
                        compact ? "text-[10px]" : "text-[11px]"
                    )}
                >
                    {formatToolCall(event.data)}
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent className={cn("mt-1 ml-4 border-l border-border pl-3")}>
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
