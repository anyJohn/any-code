"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toRenderItems } from "@/lib/renderItems";
import { useAgent } from "@/hooks/useAgent";
import { useCommand } from "@/hooks/useCommand";
import { useFileReference } from "@/hooks/useFileReference";
import type { AgentEvent } from "@/lib/sseEvents";
import { InputBox } from "./InputBox";
import { MessageList } from "./MessageList";
import { StatusBar } from "./StatusBar";

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
    const { events, pending, submit, stop, clear, appendSystem } = useAgent(
        sessionId,
        rootPath,
        initialEvents
    );
    const command = useCommand({ clear, appendSystem, submit, projectKey });
    const fileRef = useFileReference({
        projectKey,
        commandMode: command.commandMode,
        draft: command.draft,
        setDraft: command.setDraft,
    });

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

            {projectKey && <StatusBar projectKey={projectKey} events={events} />}
        </div>
    );
}
