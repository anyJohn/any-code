"use client";

import type { AgentEvent } from "@/lib/sseEvents";
import { cn } from "@/lib/utils";
import { SubagentBlock } from "./SubagentBlock";
import { TurnBlock } from "./TurnBlock";
import type { RenderItem } from "@/lib/renderItems";

const tagClass: Record<AgentEvent["type"], string> = {
    System: "text-muted-foreground",
    User: "text-primary-foreground",
    Tool: "text-muted-foreground",
    Iteration: "text-muted-foreground/70",
    AssistantDelta: "text-primary",
    Assistant: "text-primary",
    Thinking: "text-muted-foreground",
    Usage: "text-muted-foreground",
    Planning: "text-muted-foreground",
    Error: "text-destructive",
    Done: "text-muted-foreground",
    Stopped: "text-muted-foreground",
};

interface MessageListProps {
    renderItems: RenderItem[];
    events: AgentEvent[];
    pending: boolean;
    openTools: Record<string, boolean>;
    openSubs: Record<string, boolean>;
    toggleTool: (id: string) => void;
    toggleSub: (id: string) => void;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    onLayoutEffect: () => void;
}

/**
 * MessageList —— 渲染 renderItems 列表 + typing indicator + 空状态。
 * scrollRef 暴露给父组件接管滚动管理。
 */
export function MessageList({
    renderItems,
    events,
    pending,
    openTools,
    openSubs,
    toggleTool,
    toggleSub,
    scrollRef,
}: MessageListProps) {
    // pending 且本轮助手尚未回实质内容（Assistant 文本 / Tool 调用）→ 显示 typing。
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

    return (
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
                            <SubagentBlock
                                key={`sub-${item.runId}`}
                                runId={item.runId}
                                author={item.author}
                                events={item.events}
                                open={!!openSubs[item.runId]}
                                onToggle={() => toggleSub(item.runId)}
                                openTools={openTools}
                                toggleTool={toggleTool}
                            />
                        );
                    }
                    // single
                    const e = item.event;
                    if (e.type === "User") {
                        return (
                            <div key={e.id} className="flex justify-end py-2">
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
    );
}
