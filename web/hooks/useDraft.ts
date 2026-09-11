import { useCallback, useEffect, useState } from "react";

/**
 * useDraft —— 聊天输入框草稿状态，按工作区 + 会话持久（localStorage）。
 * 切工作区或切会话自动换对应草稿；清空即清除存储；存储不可用（隐私模式等）降级为内存态。
 * draft 是输入框状态（非命令状态），由 ChatView 持有并传给 useCommand / useFileReference。
 */
export function useDraft(projectKey?: string, sessionId?: string | null) {
    const draftKey = `anycode.draft.${projectKey ?? "none"}.${
        sessionId ?? "new"
    }`;
    const [draft, setDraftState] = useState(() => {
        try {
            return localStorage.getItem(draftKey) ?? "";
        } catch {
            return "";
        }
    });
    const setDraft = useCallback(
        (updater: string | ((prev: string) => string)) => {
            setDraftState((prev) => {
                const next =
                    typeof updater === "function" ? updater(prev) : updater;
                try {
                    if (next) localStorage.setItem(draftKey, next);
                    else localStorage.removeItem(draftKey);
                } catch {
                    // 存储不可用：草稿仅内存态
                }
                return next;
            });
        },
        [draftKey]
    );
    // 切工作区 / 切会话 → 换对应草稿
    useEffect(() => {
        try {
            setDraftState(localStorage.getItem(draftKey) ?? "");
        } catch {
            // ignore
        }
    }, [draftKey]);

    return { draft, setDraft };
}
