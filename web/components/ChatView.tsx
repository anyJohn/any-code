"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toRenderItems, toRenderItemsIncremental } from "@/lib/renderItems";
import { useAppDispatch } from "@/hooks/useRedux";
import { apiJson } from "@/lib/api";
import { useAgent } from "@/hooks/useAgent";
import { useCommand } from "@/hooks/useCommand";
import { useFileReference } from "@/hooks/useFileReference";
import { bumpSessions } from "@/store/workspaceSlice";
import { fmtTokens } from "@/lib/format";
import type { AgentEvent } from "@/lib/sseEvents";
import { InputBox } from "./InputBox";
import { MessageList } from "./MessageList";
import { StatusBar } from "./StatusBar";
import { InteractionModal } from "./InteractionModal";
import { PermissionModal } from "./PermissionModal";
import { SnapshotsDialog } from "./SnapshotsDialog";
import { ChangesTab } from "./ChangesTab";
import { FilesTab } from "./FilesTab";
import { FilePreviewModal } from "./FilePreviewModal";
import { TodoPanel } from "./TodoPanel";
import { useT } from "@/i18n";
import { MessagesSquare, GitCompare, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/** ChatView 主区三 tab（SPEC-036 DEC-124）：聊天（默认）/ 变更 / 文件 */
type MainTab = "chat" | "changes" | "files";

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
    const { t } = useT();
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
        reloadHistory,
    } = useAgent(sessionId, rootPath, initialEvents);
    const [snapshotsOpen, setSnapshotsOpen] = useState(false);
    const command = useCommand({
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

    // 模型切换后刷新 StatusBar 的当前模型显示（ModelPicker 回调）
    const [statusRefresh, setStatusRefresh] = useState(0);
    const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
    const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({});
    const [highlight, setHighlight] = useState(0);
    const [tab, setTab] = useState<MainTab>("chat");
    const [previewPath, setPreviewPath] = useState<string | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const didInit = useRef(false);

    // 增量渲染项（SPEC-036 B-005）：公共前缀的闭合组复用上次对象，只重算最后一个
    // 开着的组——配合 TurnBlock/SubagentBlock 的 memo，长会话追加事件不全量重渲染。
    const itemsCache = useRef<{ events: typeof events; items: ReturnType<typeof toRenderItems> } | undefined>(
        undefined
    );
    const renderItems = useMemo(
        () => toRenderItemsIncremental(events, itemsCache.current),
        [events]
    );
    useEffect(() => {
        itemsCache.current = { events, items: renderItems };
    }, [events, renderItems]);

    const toggleTool = useCallback(
        (id: string) => setOpenTools((p) => ({ ...p, [id]: !p[id] })),
        []
    );
    const toggleSub = useCallback(
        (id: string) => setOpenSubs((p) => ({ ...p, [id]: !p[id] })),
        []
    );

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
        // 发送后视图同步（用户反馈 2026-09-06）：回到聊天 tab 并滚到底
        setTab("chat");
        requestAnimationFrame(() => {
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
        });
        const task = command.draft;
        let message = task;
        if (fileRef.chips.length) {
            message =
                task +
                "\n\nFiles: " +
                fileRef.chips.map((c) => fileRef.formatEntry(c)).join(", ");
        }
        fileRef.chips.forEach((c) => fileRef.removeChip(c.path));
        command.setDraft("");
        submit(message);
    };

    const TABS: { key: MainTab; icon: React.ReactNode; label: string }[] = [
        { key: "chat", icon: <MessagesSquare className="size-3.5" />, label: t("tab.chat") },
        { key: "changes", icon: <GitCompare className="size-3.5" />, label: t("tab.changes") },
        { key: "files", icon: <FolderOpen className="size-3.5" />, label: t("tab.files") },
    ];

    return (
        <div className="h-full flex flex-col">
            {/* 三 tab（SPEC-036 DEC-124）：聊天 / 变更 / 文件 */}
            <div className="shrink-0 flex items-center gap-1 px-4 pt-2 max-w-3xl mx-auto w-full">
                {TABS.map((x) => (
                    <button
                        key={x.key}
                        onClick={() => setTab(x.key)}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                            tab === x.key
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-accent/60"
                        )}
                    >
                        {x.icon}
                        {x.label}
                    </button>
                ))}
            </div>

            {tab === "chat" && (
                <>
                    <TodoPanel events={events} />
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
                        onEditUserMessage={(ordinal, text) => {
                            void (async () => {
                                const res = await apiJson<
                                    { kept: number } | { statusMessage: string }
                                >(`/api/sessions/${currentSessionId}/truncate`, {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ keepUserMessages: ordinal }),
                                });
                                if (res && "statusMessage" in res) return;
                                await reloadHistory();
                                submit(text);
                            })();
                        }}
                    />
                </>
            )}
            {tab === "changes" && projectKey && <ChangesTab projectKey={projectKey} />}
            {tab === "files" && projectKey && (
                <FilesTab projectKey={projectKey} onOpenFile={setPreviewPath} />
            )}

            {command.compacting && (
                <div className="shrink-0 w-full max-w-3xl mx-auto px-4 pb-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="shrink-0">
                            {t("chatView.compacting")}
                        </span>
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
                projectKey={projectKey}
                onModelSwitched={() => setStatusRefresh((k) => k + 1)}
                compacting={command.compacting}
            />

            {projectKey && (
                <StatusBar
                    projectKey={projectKey}
                    events={events}
                    pending={pending}
                    refreshKey={statusRefresh}
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

            {previewPath && projectKey && (
                <FilePreviewModal
                    projectKey={projectKey}
                    filePath={previewPath}
                    onClose={() => setPreviewPath(null)}
                    onAddReference={(path, lines) => {
                        const name = path.split("/").pop() ?? path;
                        fileRef.addFile({ path, name, lines });
                        setPreviewPath(null);
                    }}
                />
            )}
        </div>
    );
}
