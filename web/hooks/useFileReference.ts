"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "@/lib/api";

export interface FileEntry {
    path: string;
    name: string;
}

/**
 * @file 引用 hook：draft 末尾 @<token> 触发文件检索弹层。
 * 与 useCommand 配合：commandMode 时不触发。
 */
export function useFileReference({
    projectKey,
    commandMode,
    draft,
    setDraft,
}: {
    projectKey?: string;
    commandMode: boolean;
    draft: string;
    setDraft: (updater: string | ((prev: string) => string)) => void;
}) {
    const [fileHighlight, setFileHighlight] = useState(0);
    const [fileItems, setFileItems] = useState<FileEntry[]>([]);
    const [chips, setChips] = useState<FileEntry[]>([]);

    // @file 引用：非斜杠指令模式下，draft 末尾匹配 @<token> 即触发文件检索弹层。
    const atMatch = !commandMode ? draft.match(/@([^\s@]*)$/) : null;
    const fileToken = atMatch ? atMatch[1] : "";
    const filePopoverOpen = !commandMode && !!atMatch && fileItems.length > 0;

    useEffect(() => {
        setFileHighlight(0);
    }, [fileItems]);

    useEffect(() => {
        if (!projectKey || commandMode || !atMatch) {
            setFileItems([]);
            return;
        }
        let cancelled = false;
        void apiJson<FileEntry[]>(
            `/api/workspaces/${projectKey}/files?q=${encodeURIComponent(fileToken)}`
        ).then((list) => {
            if (cancelled) return;
            setFileItems(list ?? []);
        });
        return () => {
            cancelled = true;
        };
    }, [projectKey, commandMode, atMatch, fileToken]);

    const selectFile = useCallback(
        (item: FileEntry) => {
            setChips((prev) =>
                prev.some((c) => c.path === item.path) ? prev : [...prev, item]
            );
            setDraft((prev: string) => prev.replace(/@([^\s@]*)$/, ""));
        },
        [setDraft]
    );

    const removeChip = useCallback((path: string) => {
        setChips((prev) => prev.filter((c) => c.path !== path));
    }, []);

    const popLastChip = useCallback(() => {
        setChips((prev) => prev.slice(0, -1));
    }, []);

    return useMemo(
        () => ({
            chips,
            fileItems,
            fileHighlight,
            setFileHighlight,
            filePopoverOpen,
            selectFile,
            removeChip,
            popLastChip,
        }),
        [
            chips,
            fileItems,
            fileHighlight,
            filePopoverOpen,
            selectFile,
            removeChip,
            popLastChip,
        ]
    );
}
