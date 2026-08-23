"use client";

import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { groupByTurn } from "@/lib/renderItems";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ToolRow } from "./ToolRow";
import type { AgentEvent } from "@/lib/sseEvents";

/**
 * SubagentBlock —— sub-agent 调用折叠块：内部按 turn 分组渲染。
 */
export function SubagentBlock({
    runId,
    author,
    events,
    open,
    onToggle,
    openTools,
    toggleTool,
}: {
    runId: string;
    author: string;
    events: AgentEvent[];
    open: boolean;
    onToggle: () => void;
    openTools: Record<string, boolean>;
    toggleTool: (id: string) => void;
}) {
    return (
        <Collapsible
            open={open}
            onOpenChange={onToggle}
            className="border-b border-border/60 py-2"
        >
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left rounded px-1.5 py-1 hover:bg-muted/50">
                <span className="text-[11px] font-mono text-muted-foreground">
                    {open ? "▾" : "▸"}
                </span>
                <span className="text-[11px] font-mono uppercase text-muted-foreground">
                    {author}
                </span>
                <span className="text-[11px] text-muted-foreground/70">
                    sub-agent · {events.length} events
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 ml-3 flex flex-col gap-2 border-l border-border pl-3">
                {groupByTurn(events).map((turn, ti) => (
                    <div
                        key={`sub-${runId}-${ti}`}
                        className="flex flex-col gap-1.5"
                    >
                        {turn.iteration && (
                            <span className="text-[10px] font-mono text-muted-foreground/60">
                                {turn.iteration.message}
                            </span>
                        )}
                        {turn.thinking && (
                            <div className="text-[10px] text-muted-foreground italic">
                                thinking · {turn.thinking.length} chars
                            </div>
                        )}
                        {turn.assistant && (
                            <MarkdownRenderer content={turn.assistant.message} />
                        )}
                        {turn.tools.map((t) => (
                            <ToolRow
                                key={t.id}
                                event={t}
                                open={!!openTools[t.id]}
                                onToggle={() => toggleTool(t.id)}
                                compact
                            />
                        ))}
                    </div>
                ))}
            </CollapsibleContent>
        </Collapsible>
    );
}
