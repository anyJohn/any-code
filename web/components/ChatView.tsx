"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toRenderItems } from "@/lib/renderItems";
import { useAppDispatch } from "@/hooks/useRedux";
import { useAgent } from "@/hooks/useAgent";
import { useCommand } from "@/hooks/useCommand";
import { useFileReference } from "@/hooks/useFileReference";
import { bumpSessions } from "@/store/workspaceSlice";
import type { AgentEvent } from "@/lib/sseEvents";
import { InputBox } from "./InputBox";
import { MessageList } from "./MessageList";
import { StatusBar } from "./StatusBar";
import { InteractionModal } from "./InteractionModal";
import { PermissionModal } from "./PermissionModal";
import { SnapshotsDialog } from "./SnapshotsDialog";

/**
 * ChatView —— 聊天主视图容器：组合 MessageList / InputBox / StatusBar，
 * 持有 useAgent + useCommand + useFileReference 三个 hooks，
 * 负责滚动管理、消息发送编排。
 */
export function ChatView({
    sessionId,
    rootPath,
    initialEvents,
    projectKey,
}: {
    sessionId: string | null;
    rootPath: string;
    initialEvents: AgentEvent[];
    projectKey?: string;
}) {
    const {
        events,
        pending,
        submit,
        stop,
        clear,
        appendSystem,
        currentSessionId,
        pendingInteraction,
        submitInteraction,
        pendingPermission,
        submitPermission,
    } = useAgent(sessionId, rootPath, initialEvents);
    const [snapshotsOpen, setSnapshotsOpen] = useState(false);
    const command = useCommand({
        clear,
        appendSystem,
        submit,
        projectKey,
        rootPath,
        currentSessionId,
        openSnapshots: () => setSnapshotsOpen(true),
    });
    const fileRef = useFileReference({
        projectKey,
        commandMode: command.commandMode,
        draft: command.draft,
        setDraft: command.setDraft,
    });

    // 新对话建会话完成（currentSessionId: null → sid）：bumpSessions 让侧栏刷新会话列表。
    // replaceState 改 URL 不触发路由渲染，侧栏无从得知新会话——靠此信号重拉（bugfix）。
    const dispatch = useAppDispatch();
    const prevSessionId = useRef<string | null>(currentSessionId);
    useEffect(() => {
        if (prevSessionId.current === null && currentSessionId !== null) {
            dispatch(bumpSessions());
        }
        prevSessionId.current = currentSessionId;
    }, [currentSessionId, dispatch]);

    // run 结束（pending true→false）：bumpSessions 拉新列表——首条任务的 LLM 会话名此时已落盘
    const prevPending = useRef(false);
    useEffect(() => {
        if (prevPending.current && !pending) dispatch(bumpSessions());
        prevPending.current = pending;
    }, [pending, dispatch]);

    const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
    const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({});
    const [highlight, setHighlight] = useState(0);

    const scrollRef = useRef<HTMLDivElement>(null);
    const didInit = useRef(false);

    const renderItems = useMemo(() => toRenderItems(events), [events]);

    const toggleTool = (id: string) =>
        setOpenTools((p) => ({ ...p, [id]: !p[id] }));
    const toggleSub = (id: string) =>
        setOpenSubs((p) => ({ ...p, [id]: !p[id] }));

    // 首次历史灌入强制滚到底（展示最新）；之后用户上滑阅读时不打断，仅 nearBottom 时滚。
    // useLayoutEffect 在 paint 前滚，避免闪顶。按 sessionId key 重挂载时 didInit 重置。
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        if (!didInit.current) {
            didInit.current = true;
            el.scrollTop = el.scrollHeight;
            return;
        }
        const nearBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 200;
        if (nearBottom) el.scrollTop = el.scrollHeight;
    }, [events.length]);

    const send = () => {
        const task = command.draft;
        let message = task;
        if (fileRef.chips.length) {
            message =
                task +
                "\n\nFiles: " +
                fileRef.chips.map((c) => c.path).join(", ");
        }
        fileRef.chips.forEach((c) => fileRef.removeChip(c.path));
        command.setDraft("");
        submit(message);
    };

    return (
        <div className="h-full flex flex-col">
            <MessageList
                renderItems={renderItems}
                events={events}
                pending={pending}
                openTools={openTools}
                openSubs={openSubs}
                toggleTool={toggleTool}
                toggleSub={toggleSub}
                scrollRef={scrollRef}
                onLayoutEffect={() => {}}
            />

            {command.compacting && (
                <div className="shrink-0 w-full max-w-3xl mx-auto px-4 pb-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="shrink-0">正在压缩上下文…</span>
                        <div className="relative h-1 flex-1 rounded-full bg-muted overflow-hidden">
                            <span className="compact-progress-bar rounded-full bg-primary" />
                        </div>
                    </div>
                </div>
            )}

            <InputBox
                draft={command.draft}
                setDraft={command.setDraft}
                pending={pending}
                chips={fileRef.chips}
                removeChip={fileRef.removeChip}
                popLastChip={fileRef.popLastChip}
                commandOpen={command.commandOpen}
                filtered={command.filtered}
                highlight={highlight}
                setHighlight={setHighlight}
                runCommand={command.runCommand}
                filePopoverOpen={fileRef.filePopoverOpen}
                fileItems={fileRef.fileItems}
                fileHighlight={fileRef.fileHighlight}
                setFileHighlight={fileRef.setFileHighlight}
                selectFile={fileRef.selectFile}
                send={send}
                stop={stop}
                runRawCommand={command.runRawCommand}
            />

            {projectKey && (
                <StatusBar
                    projectKey={projectKey}
                    events={events}
                    pending={pending}
                />
            )}

            {pendingInteraction && (
                <InteractionModal
                    data={pendingInteraction}
                    onSubmit={submitInteraction}
                    onClose={stop}
                />
            )}

            {pendingPermission && (
                <PermissionModal
                    data={pendingPermission}
                    onDecision={submitPermission}
                />
            )}

            {snapshotsOpen && projectKey && (
                <SnapshotsDialog
                    projectKey={projectKey}
                    onClose={() => setSnapshotsOpen(false)}
                />
            )}
        </div>
    );
}
