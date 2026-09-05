"use client";

import { memo } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolRow } from "./ToolRow";
import { CopyButton } from "./MarkdownRenderer";
import type { RenderItem } from "@/lib/renderItems";

/**
 * TurnBlock —— 单回合块：迭代标签 + thinking + assistant 文本 + tools。
 * memo（SPEC-036 B-005）：item 引用由增量 renderItems 保持稳定——新事件不重渲染历史回合。
 */
export const TurnBlock = memo(function TurnBlock({
    item,
    live,
    openTools,
    toggleTool,
}: {
    item: Extract<RenderItem, { kind: "turn" }>;
    /** 会话运行中（透传 ThinkingBlock：非运行态不跳表） */
    live?: boolean;
    openTools: Record<string, boolean>;
    toggleTool: (id: string) => void;
}) {
    return (
        <div className="flex flex-col gap-2 py-3 border-b border-border/60 group/turn">
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
                    {/* 整条消息复制（SPEC-036 B-002）：hover 显示，气泡右下 */}
                    <CopyButton
                        text={item.assistant.message}
                        className="p-1 rounded text-muted-foreground/0 group-hover/turn:text-muted-foreground hover:!text-foreground transition-colors self-end"
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
