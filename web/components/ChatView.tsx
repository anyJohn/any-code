"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useAgent } from "@/hooks/useAgent";
import {
    groupByTurn,
    toRenderItems,
    formatToolCall,
    toolResult,
    type RenderItem,
} from "@/lib/renderItems";
import type { AgentEvent } from "@/lib/sseEvents";
import { MarkdownRenderer } from "./MarkdownRenderer";

const tagClass: Record<AgentEvent["type"], string> = {
    System: "text-muted-foreground",
    User: "text-primary-foreground",
    Tool: "text-muted-foreground",
    Iteration: "text-muted-foreground/70",
    Assistant: "text-primary",
    Planning: "text-muted-foreground",
    Error: "text-destructive",
    Done: "text-muted-foreground",
    Stopped: "text-muted-foreground",
};

function ToolRow({
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
            <CollapsibleContent
                className={cn(
                    "mt-1 ml-4 border-l border-border pl-3",
                    compact ? "" : ""
                )}
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

function TurnBlock({
    item,
    openTools,
    toggleTool,
}: {
    item: Extract<RenderItem, { kind: "turn" }>;
    openTools: Record<string, boolean>;
    toggleTool: (id: string) => void;
}) {
    return (
        <div className="flex flex-col gap-2 py-3 border-b border-border/60">
            {item.iteration && (
                <span className="text-[10px] font-mono text-muted-foreground/60">
                    {item.iteration.message}
                </span>
            )}
            {item.assistant && (
                <div className="flex py-1">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
                        <MarkdownRenderer content={item.assistant.message} />
                    </div>
                </div>
            )}
            {item.tools.map((t) => (
                <div key={t.id} className="ml-1">
                    <ToolRow
                        event={t}
                        open={!!openTools[t.id]}
                        onToggle={() => toggleTool(t.id)}
                    />
                </div>
            ))}
        </div>
    );
}

export function ChatView({ agentId }: { agentId: string }) {
    const { events, pending, historyLoading, submit, stop } = useAgent(agentId);
    const [draft, setDraft] = useState("");
    const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
    const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({});
    const scrollRef = useRef<HTMLDivElement>(null);

    const renderItems = useMemo(() => toRenderItems(events), [events]);

    // pending 且本轮助手尚未回实质内容（Assistant 文本 / Tool 调用）→ 显示 typing。
    // 注意 agent 在 LLM 调用前就发 Iteration 事件，所以只判 last is User 会亚毫秒不可见；
    // 放宽为「上一条 User 之后无 Assistant/Tool 事件」= 仍在思考。
    const showTyping = (() => {
        if (!pending) return false;
        let lastUser = -1;
        for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].type === "User") {
                lastUser = i;
                break;
            }
        }
        if (lastUser < 0) return false;
        return events
            .slice(lastUser + 1)
            .every((e) => e.type !== "Assistant" && e.type !== "Tool");
    })();

    const toggleTool = (id: string) =>
        setOpenTools((p) => ({ ...p, [id]: !p[id] }));
    const toggleSub = (id: string) =>
        setOpenSubs((p) => ({ ...p, [id]: !p[id] }));

    // 新消息自动滚到底；用户上滑阅读时不打断；首次历史灌入强制滚到底
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const nearBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 200;
        if (nearBottom) el.scrollTop = el.scrollHeight;
    }, [events.length]);

    const send = () => {
        const task = draft;
        setDraft("");
        submit(task);
    };

    return (
        <div className="h-full flex flex-col">
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
                <div className="w-full max-w-3xl mx-auto px-4 py-4 flex flex-col gap-2">
                    {renderItems.map((item) => {
                        if (item.kind === "turn") {
                            return (
                                <TurnBlock
                                    key={`turn-${item.turnId}`}
                                    item={item}
                                    openTools={openTools}
                                    toggleTool={toggleTool}
                                />
                            );
                        }
                        if (item.kind === "subagent") {
                            return (
                                <Collapsible
                                    key={`sub-${item.runId}`}
                                    open={!!openSubs[item.runId]}
                                    onOpenChange={() => toggleSub(item.runId)}
                                    className="border-b border-border/60 py-2"
                                >
                                    <CollapsibleTrigger className="flex items-center gap-2 w-full text-left rounded px-1.5 py-1 hover:bg-muted/50">
                                        <span className="text-[11px] font-mono text-muted-foreground">
                                            {openSubs[item.runId] ? "▾" : "▸"}
                                        </span>
                                        <span className="text-[11px] font-mono uppercase text-muted-foreground">
                                            {item.author}
                                        </span>
                                        <span className="text-[11px] text-muted-foreground/70">
                                            sub-agent · {item.events.length} events
                                        </span>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="mt-2 ml-3 flex flex-col gap-2 border-l border-border pl-3">
                                        {groupByTurn(item.events).map((turn, ti) => (
                                            <div
                                                key={`sub-${item.runId}-${ti}`}
                                                className="flex flex-col gap-1.5"
                                            >
                                                {turn.iteration && (
                                                    <span className="text-[10px] font-mono text-muted-foreground/60">
                                                        {turn.iteration.message}
                                                    </span>
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
                        // single
                        const e = item.event;
                        if (e.type === "User") {
                            return (
                                <div
                                    key={e.id}
                                    className="flex justify-end py-2"
                                >
                                    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground whitespace-pre-wrap break-words">
                                        {e.message}
                                    </div>
                                </div>
                            );
                        }
                        if (e.type === "Done" || e.type === "Stopped") {
                            return (
                                <div
                                    key={e.id}
                                    className="flex justify-center py-2"
                                >
                                    <span
                                        className={cn(
                                            "text-[11px] italic",
                                            e.type === "Stopped"
                                                ? "text-amber-600 dark:text-amber-400"
                                                : "text-muted-foreground/70"
                                        )}
                                    >
                                        {e.message}
                                    </span>
                                </div>
                            );
                        }
                        // System / Error
                        return (
                            <div
                                key={e.id}
                                className="flex flex-col gap-1 py-2 border-b border-border/60 last:border-0"
                            >
                                <span
                                    className={cn(
                                        "text-[11px] font-mono uppercase",
                                        tagClass[e.type]
                                    )}
                                >
                                    {e.type}
                                </span>
                                <span className="text-sm text-foreground whitespace-pre-wrap break-words">
                                    {e.message}
                                </span>
                            </div>
                        );
                    })}
                    {historyLoading && events.length === 0 && (
                        <div className="flex flex-col gap-2 py-2">
                            <Skeleton className="h-8 w-1/3" />
                            <Skeleton className="h-20 w-2/3" />
                            <Skeleton className="h-20 w-1/2" />
                        </div>
                    )}
                    {showTyping && (
                        <div className="flex py-1">
                            <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2.5 flex items-center gap-1">
                                <span
                                    className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
                                    style={{ animationDelay: "0ms" }}
                                />
                                <span
                                    className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
                                    style={{ animationDelay: "150ms" }}
                                />
                                <span
                                    className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
                                    style={{ animationDelay: "300ms" }}
                                />
                            </div>
                        </div>
                    )}
                    {!historyLoading && events.length === 0 && (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                            发送一条消息开始对话
                        </p>
                    )}
                </div>
            </div>

            <div className="shrink-0 w-full max-w-3xl mx-auto px-4 py-3 border-t border-border bg-background flex gap-2">
                <Input
                    value={draft}
                    disabled={pending}
                    placeholder="输入任务... (Enter 发送)"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            send();
                        }
                    }}
                />
                {pending ? (
                    <Button variant="destructive" onClick={stop}>
                        停止
                    </Button>
                ) : (
                    <Button onClick={send}>发送</Button>
                )}
            </div>
        </div>
    );
}
