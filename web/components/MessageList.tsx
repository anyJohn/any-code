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
    ToolStart: "text-amber-600 dark:text-amber-400",
    ToolProgress: "text-muted-foreground",
    ToolArgProgress: "text-amber-600 dark:text-amber-400",
    Iteration: "text-muted-foreground/70",
    AssistantDelta: "text-primary",
    Assistant: "text-primary",
    Thinking: "text-muted-foreground",
    Usage: "text-muted-foreground",
    Planning: "text-muted-foreground",
    Compact: "text-amber-600 dark:text-amber-400",
    Interaction: "text-amber-600 dark:text-amber-400",
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
    // pending 且本轮尚未产出实质内容（Assistant 文本 / 思考 / 工具）→ 显示 typing dots。
    // 一旦出现 Assistant/AssistantDelta/Thinking/Tool/ToolStart/ToolProgress 即"有反馈"→ 隐藏 dots
    // （工具运行期改由活动工具卡片显实时输出，不再靠 dots）。SPEC-018 B-006
    const OUTPUT_STARTED: ReadonlySet<string> = new Set([
        "Assistant",
        "AssistantDelta",
        "Thinking",
        "Tool",
        "ToolStart",
        "ToolProgress",
        "ToolArgProgress",
    ]);
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
            .every((e) => !OUTPUT_STARTED.has(e.type));
    })();

    // 活动工具：覆盖两阶段——arguments 流式生成（ToolArgProgress，未到 ToolStart）
    // 与工具执行（ToolStart..Tool）。ToolArgProgress 期间显"正在生成… N bytes"防冻屏。SPEC-022 B-008。
    const activeTool = (() => {
        let active:
            | { phase: "generating"; name: string; bytes: number }
            | { phase: "running"; name: string; progress: string }
            | null = null;
        for (const e of events) {
            if (e.type === "ToolArgProgress") {
                const bytes = (e.data as { bytes?: number } | undefined)?.bytes ?? 0;
                active = { phase: "generating", name: e.message, bytes };
            } else if (e.type === "ToolStart") {
                active = { phase: "running", name: e.message, progress: "" };
            } else if (e.type === "ToolProgress" && active?.phase === "running") {
                active.progress += e.message;
            } else if (e.type === "Tool") {
                active = null; // 工具完成，关闭活动卡片（最终 result 由 ToolRow 渲染）
            }
        }
        return active;
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
                    const errorData = e.data as
                        | { message?: string; name?: string; stack?: string }
                        | undefined;
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
                            {errorData?.message && (
                                <span className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                                    {errorData.message}
                                </span>
                            )}
                            {errorData?.stack && (
                                <details className="text-xs text-muted-foreground/70">
                                    <summary className="cursor-pointer select-none">Stack</summary>
                                    <pre className="whitespace-pre-wrap break-words mt-1">
                                        {errorData.stack}
                                    </pre>
                                </details>
                            )}
                        </div>
                    );
                })}
                {activeTool && (
                    <div className="flex flex-col gap-1 py-2 border-b border-border/60">
                        {activeTool.phase === "generating" ? (
                            <span className="text-[11px] font-mono uppercase text-muted-foreground flex items-center gap-1.5">
                                <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                                {activeTool.name} · 正在生成… {activeTool.bytes} bytes
                            </span>
                        ) : (
                            <>
                                <span className="text-[11px] font-mono uppercase text-muted-foreground flex items-center gap-1.5">
                                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                                    {activeTool.name} · 执行中
                                </span>
                                {activeTool.progress && (
                                    <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words overflow-y-auto max-h-60 ml-4 border-l border-border pl-3">
                                        {activeTool.progress}
                                    </pre>
                                )}
                            </>
                        )}
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
                {events.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                        发送一条消息开始对话
                    </p>
                )}
            </div>
        </div>
    );
}
