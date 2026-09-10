"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CommandItem } from "@/hooks/useCommand";
import type { FileEntry } from "@/hooks/useFileReference";
import { ModelPicker } from "./ModelPicker";
import { PermissionPicker } from "./PermissionPicker";
import { useT } from "@/i18n";

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
    // 模型切换 pill（左下角，用户需求 2026-09-04）
    projectKey?: string;
    onModelSwitched?: () => void;
    /** /compact 进行中：禁用输入（该会话被压缩占用，发送会 409） */
    compacting?: boolean;
    // 未匹配指令的 Enter 路径
    runRawCommand: (rawDraft: string) => void;
    /** 当前会话 id（SPEC-037 权限 pill 用；新会话 null 不显示） */
    sessionId?: string | null;
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
    projectKey,
    onModelSwitched,
    compacting,
    sessionId,
}: InputBoxProps) {
    const { t } = useT();
    // 压缩占用会话：发送必 409——输入禁用 + 占位文案，别让用户白打
    const busy = pending || compacting;
    const taRef = useRef<HTMLTextAreaElement>(null);
    const cmdListRef = useRef<HTMLDivElement>(null);

    // 高亮项滚入可视区（键盘导航时弹层跟随）
    useEffect(() => {
        if (!commandOpen) return;
        cmdListRef.current
            ?.querySelector(`[data-cmd-idx="${highlight}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [highlight, commandOpen]);

    // 自动增高（按内容，上限 240px（10 行）后滚动）
    useLayoutEffect(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
    }, [draft]);

    // 在光标处插入换行（Alt+Enter，textarea 默认对 Alt+Enter 不插换行）
    const insertNewline = () => {
        const ta = taRef.current;
        if (!ta) {
            setDraft((prev) => `${prev}\n`);
            return;
        }
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const next = draft.slice(0, start) + "\n" + draft.slice(end);
        setDraft(next);
        requestAnimationFrame(() => {
            ta.focus();
            const pos = start + 1;
            ta.setSelectionRange(pos, pos);
            ta.style.height = "auto";
            ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
        });
    };

    return (
        <div className="shrink-0 w-full max-w-3xl mx-auto px-4 py-3">
            <div className="relative">
                {commandOpen && (
                    <div
                        ref={cmdListRef}
                        className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-popover shadow-md max-h-60 overflow-y-auto z-10"
                    >
                        {(() => {
                            // 分组：普通命令在上，技能指令在 "Skills" 标题下（用户需求 2026-09-07）
                            const normal = filtered.filter((c) => !c.skill);
                            const skills = filtered.filter((c) => c.skill);
                            const indexOf = new Map(
                                filtered.map((c, i) => [c.name, i])
                            );
                            const renderItem = (c: CommandItem) => {
                                const i = indexOf.get(c.name) ?? 0;
                                return (
                                    <button
                                        key={`${c.skill ? "s" : "c"}-${c.name}`}
                                        type="button"
                                        data-cmd-idx={i}
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
                                );
                            };
                            return (
                                <>
                                    {normal.map(renderItem)}
                                    {skills.length > 0 && normal.length > 0 && (
                                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 border-t border-border/60">
                                            Skills
                                        </div>
                                    )}
                                    {skills.map(renderItem)}
                                </>
                            );
                        })()}
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
                                        {c.lines
                                            ? `:${c.lines[0]}-${c.lines[1]}`
                                            : ""}
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
                    <textarea
                            ref={taRef}
                            value={draft}
                            disabled={compacting}
                            rows={1}
                            placeholder={t("inputBox.placeholder")}
                            className="resize-none border-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 bg-transparent text-sm leading-6 max-h-60 overflow-y-auto py-1.5"
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                // IME 组合中（中文输入确认候选词的 Enter）不触发任何发送/指令
                                if (e.nativeEvent.isComposing) return;
                                // Alt+Enter 换行（优先，无视弹层）
                                if (e.altKey && e.key === "Enter") {
                                    e.preventDefault();
                                    insertNewline();
                                    return;
                                }
                                if (commandOpen) {
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        // 钳制到边界（不循环）——到底即停
                                        setHighlight((h) => Math.min(h + 1, filtered.length - 1));
                                        return;
                                    }
                                    if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        setHighlight((h) => Math.max(h - 1, 0));
                                        return;
                                    }
                                    // Tab 补全指令名（填入输入框，不执行）；
                                    // Enter 执行高亮指令。
                                    if (e.key === "Tab") {
                                        e.preventDefault();
                                        const idx = Math.min(
                                            highlight,
                                            filtered.length - 1
                                        );
                                        const name = filtered[idx].name;
                                        setDraft(`/${name} `);
                                        return;
                                    }
                                    if (e.key === "Enter" && !e.shiftKey) {
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
                                // Enter（无 Alt/Shift）发送；Shift+Enter 走 textarea 默认换行
                                if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
                                    e.preventDefault();
                                    send();
                                }
                            }}
                        />
                        {/* 底部工具栏（参考 ChatGPT/LibreChat composer）：左模型切换，右发送 */}
                        <div className="flex items-center justify-between pt-0.5">
                            <ModelPicker
                                projectKey={projectKey}
                                disabled={pending}
                                onSwitched={() => onModelSwitched?.()}
                            />
                            <div className="flex items-center gap-1.5">
                                <PermissionPicker sessionId={sessionId ?? null} />
                                {pending ? (
                                    <>
                                        {/* queue 消息：运行中发送进队列，下轮对话注入 */}
                                        <Button
                                            size="sm"
                                            onClick={send}
                                            disabled={!draft.trim() || compacting}
                                            title={t("inputBox.queue")}
                                        >
                                            {t("inputBox.send")}
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="icon"
                                            onClick={stop}
                                            title={t("inputBox.stop")}
                                            className="size-8 rounded-lg"
                                        >
                                            <Square className="size-3 fill-current" />
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        size="sm"
                                        onClick={send}
                                        disabled={compacting}
                                        title={t("inputBox.send")}
                                    >
                                        {t("inputBox.send")}
                                    </Button>
                                )}
                            </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
