"use client";

import { useState } from "react";
import type { AgentEvent } from "@/lib/sseEvents";
import { Pencil, Check, X } from "lucide-react";
import { CopyButton } from "./MarkdownRenderer";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { SubagentBlock } from "./SubagentBlock";
import { TurnBlock } from "./TurnBlock";
import { Logo } from "./Logo";
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
    Permission: "text-amber-600 dark:text-amber-400",
    PermissionAsk: "text-amber-600 dark:text-amber-400",
    Error: "text-destructive",
    Warning: "text-amber-600 dark:text-amber-400",
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
    /** 编辑用户消息重发（B-013）：ordinal=第几条 user 消息（0-based），text=编辑后文本 */
    onEditUserMessage: (ordinal: number, text: string) => void;
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
    onEditUserMessage,
}: MessageListProps) {
    const { t } = useT();
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
                const bytes =
                    (e.data as { bytes?: number } | undefined)?.bytes ?? 0;
                active = { phase: "generating", name: e.message, bytes };
            } else if (e.type === "ToolStart") {
                active = { phase: "running", name: e.message, progress: "" };
            } else if (
                e.type === "ToolProgress" &&
                active?.phase === "running"
            ) {
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
                {renderItems.map((item, i) => {
                    if (item.kind === "turn") {
                        return (
                            <TurnBlock
                                key={`turn-${item.turnId}`}
                                item={item}
                                live={pending}
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
                            <UserBubble
                                key={e.id}
                                event={e}
                                ordinal={userOrdinal(renderItems, i)}
                                onEdit={onEditUserMessage}
                            />
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
                    // System / Error / Warning —— Error/Warning 经 error 字段（domain serializeError）
                    const errorData =
                        e.type === "Error" || e.type === "Warning"
                            ? e.error
                            : undefined;
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
                                    <summary className="cursor-pointer select-none">
                                        Stack
                                    </summary>
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
                                {t("messageList.generating", {
                                    name: activeTool.name,
                                    bytes: activeTool.bytes,
                                })}
                            </span>
                        ) : (
                            <>
                                <span className="text-[11px] font-mono uppercase text-muted-foreground flex items-center gap-1.5">
                                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                                    {t("messageList.running", {
                                        name: activeTool.name,
                                    })}
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
                    <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <Logo size={36} />
                        <p className="text-sm text-muted-foreground">
                            {t("messageList.emptyHint")}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}


/** 该 User 渲染项是第几条 user 消息（0-based）——截断 API 的定位序数 */
function userOrdinal(items: RenderItem[], index: number): number {
    let n = 0;
    for (let k = 0; k < index; k++) {
        const it = items[k];
        if (it.kind === "single" && it.event.type === "User") n++;
    }
    return n;
}

/**
 * 用户消息气泡（B-013）：hover 出编辑按钮 → textarea 编辑 → 确认后
 * onEdit(ordinal, text) 截断重发。编辑中按钮变确认/取消。
 */
function UserBubble({
    event,
    ordinal,
    onEdit,
}: {
    event: Extract<AgentEvent, { type: "User" }>;
    ordinal: number;
    onEdit: (ordinal: number, text: string) => void;
}) {
    const { t } = useT();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(event.message);

    if (editing) {
        return (
            <div key={event.id} className="flex justify-end py-2">
                <div className="w-[80%] flex flex-col gap-1.5 rounded-2xl rounded-br-sm border border-primary/40 bg-primary/10 px-3 py-2">
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={Math.min(8, draft.split("\n").length + 1)}
                        className="w-full resize-none bg-transparent text-sm outline-none whitespace-pre-wrap"
                        autoFocus
                    />
                    <div className="flex justify-end gap-1.5">
                        <button
                            onClick={() => {
                                setDraft(event.message);
                                setEditing(false);
                            }}
                            title={t("common.cancel")}
                            className="p-1 rounded text-muted-foreground hover:text-foreground"
                        >
                            <X className="size-3.5" />
                        </button>
                        <button
                            onClick={() => {
                                const text = draft.trim();
                                if (!text) return;
                                setEditing(false);
                                onEdit(ordinal, text);
                            }}
                            title={t("chat.resend")}
                            className="p-1 rounded text-primary hover:bg-primary/10"
                        >
                            <Check className="size-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div key={event.id} className="flex justify-end py-2 group/msg">
            <div className="max-w-[80%] flex flex-col items-start">
                <div className="rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground whitespace-pre-wrap break-words select-text">
                    {event.message}
                </div>
                {/* 复制 + 编辑：气泡下方左缘（用户反馈 2026-09-06） */}
                <div className="flex gap-0.5 mt-0.5">
                    <CopyButton
                        text={event.message}
                        className="p-1 rounded text-muted-foreground/0 group-hover/msg:text-muted-foreground hover:!text-foreground transition-colors"
                    />
                    <button
                        onClick={() => {
                            setDraft(event.message);
                            setEditing(true);
                        }}
                        title={t("chat.editMessage")}
                        className="p-1 rounded text-muted-foreground/0 group-hover/msg:text-muted-foreground hover:!text-foreground transition-colors"
                    >
                        <Pencil className="size-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
}
