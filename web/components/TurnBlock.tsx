"use client";

import { MarkdownRenderer } from "./MarkdownRenderer";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolRow } from "./ToolRow";
import type { RenderItem } from "@/lib/renderItems";

/**
 * TurnBlock —— 单回合块：迭代标签 + thinking + assistant 文本 + tools。
 */
export function TurnBlock({
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
            {item.thinking && (
                <ThinkingBlock
                    content={item.thinking}
                    finished={!!item.assistant}
                />
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
