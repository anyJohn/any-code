"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "@/lib/api";
import { matchAtFileToken } from "@/lib/atFile";

export interface FileEntry {
    path: string;
    name: string;
    /** 行号引用（SPEC-036 B-010/B-011）：preview 划选起止行，如 10-20 */
    lines?: [number, number];
}

/**
 * @file 引用 hook：draft 末尾 @<token>（@ 前须空格/行首）触发文件检索弹层。
 * 与 useCommand 配合：commandMode 时不触发。
 *
 * 3 个交互修复（SPEC-021 B-006/007/008）：
 * - effect 依赖 fileToken（稳定 string）+ atActive（boolean），非 atMatch 引用——避免 setFileItems
 *   触发 render → atMatch 新引用 → effect 重跑 → 循环调 /files。
 * - 空 token（@ 单独）也检索（q=空 → 全量前 20）。
 * - @ 前必须空格/行首（matchAtFileToken 正则）。
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

    const token = !commandMode ? matchAtFileToken(draft) : null;
    const atActive = token !== null;
    const fileToken = token ?? "";
    const filePopoverOpen = !commandMode && atActive && fileItems.length > 0;

    useEffect(() => {
        setFileHighlight(0);
    }, [fileItems]);

    // 检索 debounce 250ms；依赖 fileToken（string）+ atActive（boolean）——稳定 primitive，
    // setFileItems 触发的 render 不会重跑 effect（修循环）。atActive 为假时清空列表。
    useEffect(() => {
        if (!projectKey || commandMode || !atActive) {
            setFileItems([]);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            void apiJson<FileEntry[]>(
                `/api/workspaces/${projectKey}/files?q=${encodeURIComponent(fileToken)}`
            ).then((list) => {
                if (!cancelled) setFileItems(list ?? []);
            });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [projectKey, commandMode, atActive, fileToken]);

    const selectFile = useCallback(
        (item: FileEntry) => {
            setChips((prev) =>
                prev.some((c) => c.path === item.path) ? prev : [...prev, item]
            );
            setDraft((prev: string) => prev.replace(/@([^\s@]*)$/, ""));
        },
        [setDraft]
    );

    /** 添加/替换引用（SPEC-036 B-010）：preview 划选行或整文件。同路径覆盖旧 chip。 */
    const addFile = useCallback((item: FileEntry) => {
        setChips((prev) => {
            const rest = prev.filter((c) => c.path !== item.path);
            return [...rest, item];
        });
    }, []);

    /** 引用格式化（发送拼接用）：path 或 path:10-20 */
    const formatEntry = (c: FileEntry): string =>
        c.lines ? `${c.path}:${c.lines[0]}-${c.lines[1]}` : c.path;

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
            addFile,
            formatEntry,
            removeChip,
            popLastChip,
        }),
        [
            chips,
            fileItems,
            fileHighlight,
            filePopoverOpen,
            selectFile,
            addFile,
            formatEntry,
            removeChip,
            popLastChip,
        ]
    );
}

