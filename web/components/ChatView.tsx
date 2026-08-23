"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useAgent } from "@/hooks/useAgent";
import { apiJson } from "@/lib/api";
import {
    groupByTurn,
    toRenderItems,
    formatToolCall,
    toolResult,
    type RenderItem,
} from "@/lib/renderItems";
import type { AgentEvent, UsageData } from "@/lib/sseEvents";
import { MarkdownRenderer } from "./MarkdownRenderer";

const tagClass: Record<AgentEvent["type"], string> = {
    System: "text-muted-foreground",
    User: "text-primary-foreground",
    Tool: "text-muted-foreground",
    Iteration: "text-muted-foreground/70",
    AssistantDelta: "text-primary",
    Assistant: "text-primary",
    Usage: "text-muted-foreground",
    Planning: "text-muted-foreground",
    Error: "text-destructive",
    Done: "text-muted-foreground",
    Stopped: "text-muted-foreground",
};

interface StatusInfo {
    provider: string;
    model: string;
    contextWindow: number;
    skillCount: number;
    mcpCount: number;
}

/**
 * StatusBar —— 聊天区底部状态条：模型 / 上下文用量 / 技能数 / MCP 数。
 * 静态信息挂载时拉一次，上下文用量取最新 Usage 事件实时更新。
 */
function StatusBar({ projectKey, events }: { projectKey: string; events: AgentEvent[] }) {
    const [status, setStatus] = useState<StatusInfo>({
        provider: "",
        model: "",
        contextWindow: 128000,
        skillCount: 0,
        mcpCount: 0,
    });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const data = await apiJson<StatusInfo & { skillNames: string[]; mcpServers: { name: string; type: string }[] }>(
                `/api/workspaces/${projectKey}/status`
            );
            if (cancelled || !data) return;
            setStatus({
                provider: data.provider,
                model: data.model,
                contextWindow: data.contextWindow,
                skillCount: data.skillCount,
                mcpCount: data.mcpServers.length,
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [projectKey]);

    // 最新 Usage 事件 → 实时 token 用量
    let promptTokens = 0;
    let ctxWindow = status.contextWindow;
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === "Usage") {
            const d = events[i].data as UsageData | undefined;
            if (d) {
                promptTokens = d.prompt_tokens;
                ctxWindow = d.contextWindow || status.contextWindow;
            }
            break;
        }
    }
    const pct = ctxWindow > 0 ? Math.min(100, (promptTokens / ctxWindow) * 100) : 0;
    const modelLabel = status.model
        ? status.provider
            ? `${status.provider}/${status.model}`
            : status.model
        : "—";

    return (
        <div className="shrink-0 border-t border-border px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-3 max-w-3xl mx-auto w-full">
            <span className="truncate font-mono">{modelLabel}</span>
            <div className="flex items-center gap-1.5 min-w-0" title={`${promptTokens} / ${ctxWindow}`}>
                <span className="tabular-nums shrink-0">
                    {promptTokens}/{ctxWindow}
                </span>
                <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden shrink-0">
                    <div
                        className={cn(
                            "h-full rounded-full transition-all",
                            pct > 80 ? "bg-amber-500" : "bg-primary/60"
                        )}
                        style={{ width: `${pct}%` }}
                    />
                </div>
            </div>
            <span className="shrink-0">skill: {status.skillCount}</span>
            <span className="shrink-0">mcp: {status.mcpCount}</span>
        </div>
    );
}


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

export function ChatView({
    sessionId,
    rootPath,
    initialEvents,
    projectKey,
}: {
    sessionId: string | null;
    rootPath: string;
    initialEvents: AgentEvent[];
    projectKey?: string;
}) {
    const { events, pending, submit, stop } = useAgent(
        sessionId,
        rootPath,
        initialEvents
    );
    const [draft, setDraft] = useState("");
    const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
    const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({});
    const scrollRef = useRef<HTMLDivElement>(null);
    const didInit = useRef(false);

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

    // 首次历史灌入强制滚到底（展示最新）；之后用户上滑阅读时不打断，仅 nearBottom 时滚。
    // useLayoutEffect 在 paint 前滚，避免闪顶。按 sessionId key 重挂载时 didInit 重置。
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        if (!didInit.current) {
            didInit.current = true;
            el.scrollTop = el.scrollHeight;
            return;
        }
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
                    {events.length === 0 && (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                            发送一条消息开始对话
                        </p>
                    )}
                </div>
            </div>

            <div className="shrink-0 w-full max-w-3xl mx-auto px-4 py-3">
                <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
                    <Input
                        value={draft}
                        disabled={pending}
                        placeholder="输入任务... (Enter 发送)"
                        className="border-0 focus-visible:ring-0 bg-transparent"
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

            {projectKey && <StatusBar projectKey={projectKey} events={events} />}
        </div>
    );
}
