"use client";

import { memo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolRow } from "./ToolRow";
import { CopyButton } from "./MarkdownRenderer";
import type { RenderItem } from "@/lib/renderItems";

/**
 * TurnBlock —— 单回合块：迭代标签 + thinking + assistant 文本 + tools。
 * memo（SPEC-036 B-005）：item 引用由增量 renderItems 保持稳定——新事件不重渲染历史回合。
 */
/** 工具调用计数摘要："bash ×3 · read ×2" */
function toolSummary(item: Extract<RenderItem, { kind: "turn" }>): string {
    const counts = new Map<string, number>();
    for (const t of item.tools) {
        const n = (t.data as { name?: string }).name ?? "?";
        counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()].map(([n, c]) => `${n} ×${c}`).join(" · ");
}

/** 回合过程耗时（思考秒数，有起止才显示） */
function thinkingSecs(item: Extract<RenderItem, { kind: "turn" }>): string | null {
    if (!item.thinking) return null;
    if (!item.thinkingFinished || !item.thinkingEndedAt) return null;
    const secs = Math.round((item.thinkingEndedAt - (item.thinkingStartedAt ?? item.thinkingEndedAt)) / 1000);
    return `思考 ${Math.max(secs, 1)}s`;
}

/**
 * TurnBlock —— 单回合块。聚合消息（用户需求 2026-09-07）：
 * 折叠时只显示过程摘要行（思考时长 + 工具计数 + 错误标记），assistant 回答
 * 始终可见；展开看完整明细。历史回合默认收起，最新回合展开（实时观战）。
 */
export const TurnBlock = memo(function TurnBlock({
    item,
    live,
    openTools,
    toggleTool,
    collapsed,
    onToggle,
}: {
    item: Extract<RenderItem, { kind: "turn" }>;
    /** 会话运行中（透传 ThinkingBlock：非运行态不跳表） */
    live?: boolean;
    openTools: Record<string, boolean>;
    toggleTool: (id: string) => void;
    /** 聚合折叠态（true = 只显摘要行） */
    collapsed?: boolean;
    onToggle?: () => void;
}) {
    // 折叠态摘要行：箭头（DesignSpec：左侧，收起朝右/展开朝下）+ 过程统计 + 错误标记
    const processCount =
        (item.thinking ? 1 : 0) + item.tools.length;
    if (collapsed && processCount > 1) {
        const secs = thinkingSecs(item);
        const tools = toolSummary(item);
        const hasError = item.tools.some((t) =>
            String((t.data as { result?: string }).result ?? "").startsWith("Error")
        );
        // 无过程内容（无思考/无工具）→ 没有可折叠的东西，直接渲染回答
        const hasProcess = !!(secs || tools || hasError);
        return (
            <div className="flex flex-col gap-2 py-3 border-b border-border/60 group/turn">
                {hasProcess && (
                    <button
                        onClick={onToggle}
                        className="flex items-center gap-1.5 w-full text-left text-xs text-muted-foreground hover:bg-accent/60 rounded px-1.5 py-1 -mx-1.5"
                    >
                        <ChevronRight className="size-3.5 shrink-0" />
                        {secs && <span>{secs}</span>}
                        {tools && <span className="font-mono">{tools}</span>}
                        {hasError && (
                            <span className="text-destructive">· 有工具报错</span>
                        )}
                    </button>
                )}
                {item.assistant && (
                    <div className="flex flex-col items-start gap-0.5 py-1">
                        <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
                            <MarkdownRenderer content={item.assistant.message} />
                        </div>
                        <CopyButton
                            text={item.assistant.message}
                            className="p-1 rounded text-muted-foreground/0 group-hover/turn:text-muted-foreground hover:!text-foreground transition-colors"
                        />
                    </div>
                )}
            </div>
        );
    }
    const secs = thinkingSecs(item);
    const tools = toolSummary(item);
    const hasSummary = processCount > 1;
    return (
        <div className="flex flex-col gap-2 py-3 border-b border-border/60 group/turn">
            {/* 展开态摘要行：仅可聚合回合显示（单条过程回合无摘要行） */}
            {onToggle && hasSummary && (
                <button
                    onClick={onToggle}
                    className="flex items-center gap-1.5 w-full text-left text-xs text-muted-foreground hover:bg-accent/60 rounded px-1.5 py-1 -mx-1.5"
                >
                    <ChevronDown className="size-3.5 shrink-0" />
                    {secs && <span>{secs}</span>}
                    {tools && <span className="font-mono">{tools}</span>}
                </button>
            )}
            {item.iteration && (
                <span className="text-[10px] font-mono text-muted-foreground/60">
                    {item.iteration.message}
                </span>
            )}
            {item.thinking && (
                <ThinkingBlock
                    content={item.thinking}
                    finished={item.thinkingFinished}
                    startedAt={item.thinkingStartedAt}
                    endedAt={item.thinkingEndedAt}
                    live={live}
                />
            )}
            {item.assistant && (
                <div className="flex flex-col items-start gap-0.5 py-1 group/turn">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
                        <MarkdownRenderer content={item.assistant.message} />
                    </div>
                    {/* 整条消息复制（B-002）：hover 显示，气泡左下（用户反馈 2026-09-06） */}
                    <CopyButton
                        text={item.assistant.message}
                        className="p-1 rounded text-muted-foreground/0 group-hover/turn:text-muted-foreground hover:!text-foreground transition-colors"
                    />
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
});
