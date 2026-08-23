"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CommandItem } from "@/hooks/useCommand";
import type { FileEntry } from "@/hooks/useFileReference";

interface InputBoxProps {
    draft: string;
    setDraft: (updater: string | ((prev: string) => string)) => void;
    pending: boolean;
    chips: FileEntry[];
    removeChip: (path: string) => void;
    popLastChip: () => void;
    // 斜杠命令弹层
    commandOpen: boolean;
    filtered: CommandItem[];
    highlight: number;
    setHighlight: (updater: number | ((prev: number) => number)) => void;
    runCommand: (name: string) => void;
    // @file 弹层
    filePopoverOpen: boolean;
    fileItems: FileEntry[];
    fileHighlight: number;
    setFileHighlight: (updater: number | ((prev: number) => number)) => void;
    selectFile: (item: FileEntry) => void;
    // 发送
    send: () => void;
    stop: () => void;
    // 未匹配指令的 Enter 路径
    runRawCommand: (rawDraft: string) => void;
}

/**
 * InputBox —— 输入框 + 斜杠命令弹层 + @file 弹层 + 文件 chips。
 * 纯展示组件，逻辑由 hooks 传入。
 */
export function InputBox({
    draft,
    setDraft,
    pending,
    chips,
    removeChip,
    popLastChip,
    commandOpen,
    filtered,
    highlight,
    setHighlight,
    runCommand,
    filePopoverOpen,
    fileItems,
    fileHighlight,
    setFileHighlight,
    selectFile,
    send,
    stop,
    runRawCommand,
}: InputBoxProps) {
    return (
        <div className="shrink-0 w-full max-w-3xl mx-auto px-4 py-3">
            <div className="relative">
                {commandOpen && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-popover shadow-md max-h-60 overflow-y-auto z-10">
                        {filtered.map((c, i) => (
                            <button
                                key={c.name}
                                type="button"
                                className={cn(
                                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                                    i === highlight
                                        ? "bg-accent"
                                        : "hover:bg-accent/50"
                                )}
                                onMouseEnter={() => setHighlight(i)}
                                onClick={() => runCommand(c.name)}
                            >
                                <span className="font-mono text-primary shrink-0">
                                    /{c.name}
                                </span>
                                <span className="text-xs text-muted-foreground truncate">
                                    {c.desc}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
                {filePopoverOpen && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-popover shadow-md max-h-60 overflow-y-auto z-10">
                        {fileItems.map((f, i) => (
                            <button
                                key={f.path}
                                type="button"
                                className={cn(
                                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                                    i === fileHighlight
                                        ? "bg-accent"
                                        : "hover:bg-accent/50"
                                )}
                                onMouseEnter={() => setFileHighlight(i)}
                                onClick={() => selectFile(f)}
                            >
                                <span className="font-mono text-primary shrink-0 truncate">
                                    {f.name}
                                </span>
                                <span className="text-xs text-muted-foreground truncate">
                                    {f.path}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
                <div className="flex flex-col gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
                    {chips.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {chips.map((c) => (
                                <span
                                    key={c.path}
                                    title={c.path}
                                    className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"
                                >
                                    <span className="font-mono text-primary truncate max-w-[12rem]">
                                        {c.name}
                                    </span>
                                    <button
                                        type="button"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => removeChip(c.path)}
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <Input
                            value={draft}
                            disabled={pending}
                            placeholder="输入任务... (Enter 发送，/ 指令，@ 文件)"
                            className="border-0 focus-visible:ring-0 bg-transparent"
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (commandOpen) {
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        setHighlight((h) => (h + 1) % filtered.length);
                                        return;
                                    }
                                    if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        setHighlight(
                                            (h) => (h - 1 + filtered.length) % filtered.length
                                        );
                                        return;
                                    }
                                    if (
                                        e.key === "Tab" ||
                                        (e.key === "Enter" && !e.shiftKey)
                                    ) {
                                        e.preventDefault();
                                        const idx = Math.min(
                                            highlight,
                                            filtered.length - 1
                                        );
                                        runCommand(filtered[idx].name);
                                        return;
                                    }
                                    if (e.key === "Escape") {
                                        e.preventDefault();
                                        setDraft("");
                                        return;
                                    }
                                } else if (filePopoverOpen) {
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        setFileHighlight(
                                            (h) => (h + 1) % fileItems.length
                                        );
                                        return;
                                    }
                                    if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        setFileHighlight(
                                            (h) =>
                                                (h - 1 + fileItems.length) %
                                                fileItems.length
                                        );
                                        return;
                                    }
                                    if (
                                        e.key === "Tab" ||
                                        (e.key === "Enter" && !e.shiftKey)
                                    ) {
                                        e.preventDefault();
                                        const idx = Math.min(
                                            fileHighlight,
                                            fileItems.length - 1
                                        );
                                        selectFile(fileItems[idx]);
                                        return;
                                    }
                                    if (e.key === "Escape") {
                                        e.preventDefault();
                                        return;
                                    }
                                } else if (
                                    e.key === "Backspace" &&
                                    draft === "" &&
                                    chips.length > 0
                                ) {
                                    popLastChip();
                                    return;
                                } else if (
                                    draft.startsWith("/") &&
                                    e.key === "Enter" &&
                                    !e.shiftKey
                                ) {
                                    // 无匹配的未知指令：交给 runRawCommand 报未知
                                    e.preventDefault();
                                    runRawCommand(draft);
                                    return;
                                }
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
            </div>
        </div>
    );
}
