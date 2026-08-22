import React, { useEffect, useRef, useCallback, useState } from "react";
import { Box, Text, useApp, Static } from "ink";
import Logo from "./Logo";
import { MessageItem } from "./MessageList";
import InputBox, { Command } from "./InputBox";
import SessionSelect from "./SessionSelect";
import { Message, MessageType } from "../types";
import {
    AnyAgent,
    EventType,
    SessionService,
    SessionMeta,
} from "@any-code/domain";

interface AppProps {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    sessionId?: string;
    /** 切换 session 时由 cli 层重新 render 整个 App（unmount 旧实例以重置 Ink 的 static 输出缓冲） */
    onSwitchSession?: (sessionId: string) => void;
}

let messageIdCounter = 0;

export default function App(props: AppProps) {
    const { exit } = useApp();
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    // 当前任务文本用 state 而非 ref：pendingTasks$ 长度恒 >0 时 setIsProcessing 会 bail-out，
    // ref 变更不触发重渲染会导致显示陈旧
    const [currentTaskText, setCurrentTaskText] = useState("");
    // 流式输出实时区：<Static> 按 index 缓存、不可重渲，故流式 delta 只能累积到
    // state 在实时区重绘最后一帧，等定稿事件到达再整体入 <Static>
    const [streamingText, setStreamingText] = useState("");
    const streamingTurnIdRef = useRef<string | null>(null);
    // 当前 session id —— 作为 <Static> 的 key，切换 session 时强制 remount 清空缓存的旧消息
    const [currentSessionId, setCurrentSessionId] = useState<
        string | undefined
    >(props.sessionId);

    // session 选择 overlay（/resume 多条 session 时）
    const [sessionSelectMode, setSessionSelectMode] = useState(false);
    const [sessionList, setSessionList] = useState<SessionMeta[]>([]);

    const agentRef = useRef<AnyAgent | null>(null);
    const serviceRef = useRef<SessionService | null>(null);
    const pkRef = useRef<string>("");
    const subscriptionsRef = useRef<Array<{ unsubscribe: () => void }>>([]);
    const initializedRef = useRef(false);

    // Apply CLI config overrides to env vars before agent init
    if (props.apiKey) process.env.OPENAI_API_KEY = props.apiKey;
    if (props.baseUrl) process.env.OPENAI_BASE_URL = props.baseUrl;
    if (props.model) process.env.OPENAI_MODEL = props.model;

    // ChatMessage.content 可能是 string | null | 多模态数组（vision/tool 消息），
    // 直接 as string 会让数组渲染成 [object Object]
    const contentToString = useCallback((content: unknown): string => {
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
            return content
                .map((part: unknown) =>
                    typeof part === "string"
                        ? part
                        : (part as { text?: string } | null)?.text ?? ""
                )
                .join("");
        }
        return "";
    }, []);

    // Map domain EventType to TUI MessageType
    const mapEventType = useCallback((eventType: EventType): MessageType => {
        const eventTypeMap: Record<EventType, MessageType> = {
            [EventType.SYSTEM]: MessageType.SYSTEM,
            [EventType.USER]: MessageType.USER,
            [EventType.TOOL]: MessageType.TOOL,
            [EventType.ITERATION]: MessageType.ITERATION,
            [EventType.ASSISTANT_DELTA]: MessageType.ASSISTANT,
            [EventType.ASSISTANT]: MessageType.ASSISTANT,
            [EventType.PLANNING]: MessageType.PLANNING,
            [EventType.ERROR]: MessageType.ERROR,
            [EventType.DONE]: MessageType.SYSTEM,
            [EventType.STOPPED]: MessageType.SYSTEM,
        };
        return eventTypeMap[eventType] || MessageType.SYSTEM;
    }, []);

    const addMessage = useCallback(
        (type: MessageType, content: string, data?: unknown) => {
            messageIdCounter += 1;
            const newMessage: Message = {
                id: `msg-${messageIdCounter}`,
                type,
                content,
                timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, newMessage]);

            if (data !== undefined && data !== null) {
                const dataContent =
                    typeof data === "string"
                        ? data
                        : JSON.stringify(data, null, 2);
                messageIdCounter += 1;
                const dataMessage: Message = {
                    id: `msg-${messageIdCounter}`,
                    type: MessageType.SYSTEM,
                    content: dataContent,
                    timestamp: Date.now(),
                };
                setMessages((prev) => [...prev, dataMessage]);
            }
        },
        []
    );

    const initAgent = useCallback(
        async (sessionId?: string) => {
            const agent = await AnyAgent.create({
                rootPath: process.cwd(),
                sessionId,
            });
            agentRef.current = agent;
            serviceRef.current = agent.getService();
            pkRef.current = agent.getProjectKey();

            // 回显历史消息（新 session 尚未创建，无历史）
            const sess = agent.getSession();
            const historyMessages: Message[] = sess
                ? sess.messages
                      .filter((m) => m.role !== "system")
                      .map((m) => ({
                          id: `hist-${Date.now()}-${Math.random()}`,
                          type:
                              m.role === "user"
                                  ? MessageType.USER
                                  : MessageType.ASSISTANT,
                          content: contentToString(m.content),
                          timestamp: Date.now(),
                      }))
                : [];
            messageIdCounter = historyMessages.length;
            setMessages(historyMessages);
            // 切换 session 时改变 Static key → remount → 清空旧 session 缓存的消息
            setCurrentSessionId(sess?.id);
            if (sess) {
                addMessage(
                    MessageType.SYSTEM,
                    `Resumed session: ${sess.title}`
                );
            }

            // Subscribe to agent's event stream
            const eventSubscription = agent.eventStream$.subscribe({
                next: (event) => {
                    if (event.type === EventType.ASSISTANT_DELTA) {
                        // 流式增量：累积到实时区，不入 <Static>（Static 按 index
                        // 缓存、永不重渲，逐 token 追加会刷屏）
                        setStreamingText(
                            (prev) => prev + (event.message ?? "")
                        );
                        streamingTurnIdRef.current =
                            event.turnId ?? streamingTurnIdRef.current;
                        return;
                    }
                    if (event.type === EventType.ASSISTANT) {
                        // 定稿：整条入 <Static>，清空实时区
                        addMessage(
                            MessageType.ASSISTANT,
                            event.message,
                            event.data
                        );
                        setStreamingText("");
                        streamingTurnIdRef.current = null;
                        return;
                    }
                    if (event.type === EventType.STOPPED) {
                        // 中断时丢弃未定稿的流式片段
                        setStreamingText("");
                        streamingTurnIdRef.current = null;
                    }
                    addMessage(
                        mapEventType(event.type),
                        event.message,
                        event.data
                    );
                },
                error: (errEvent) => {
                    addMessage(
                        mapEventType(errEvent.type),
                        errEvent.message,
                        errEvent.data
                    );
                },
            });
            subscriptionsRef.current.push(eventSubscription);

            // Subscribe to pending tasks to track completion
            const taskSubscription = agent.pendingTasks$.subscribe((tasks) => {
                setIsProcessing(tasks.length > 0);
                setCurrentTaskText(
                    tasks.length > 0 ? "✻ Current Task: " + tasks[0] : ""
                );
            });
            subscriptionsRef.current.push(taskSubscription);
            setIsProcessing(false);
        },
        [addMessage, mapEventType, contentToString]
    );

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        let cancelled = false;
        initAgent(props.sessionId).catch((err) => {
            if (!cancelled) {
                addMessage(MessageType.ERROR, `Failed to init agent: ${err}`);
            }
        });

        return () => {
            cancelled = true;
            subscriptionsRef.current.forEach((sub) => sub.unsubscribe());
            subscriptionsRef.current = [];
            if (agentRef.current) {
                agentRef.current.destroy();
            }
        };
    }, []);

    const handleCancel = () => {
        addMessage(MessageType.SYSTEM, "Stopping agent...");
        if (agentRef.current) {
            agentRef.current.stop();
        }
        setTimeout(() => {
            addMessage(MessageType.SYSTEM, "Goodbye!");
            setTimeout(() => {
                exit();
            }, 500);
        }, 300);
    };

    const handleSubmit = async (value: string) => {
        if (isProcessing) {
            addMessage(
                MessageType.ERROR,
                "Please wait for the current task to complete."
            );
            return;
        }

        // 斜杠命令：内联候选已在 InputBox 展示，这里处理 Enter 提交
        if (value.startsWith("/")) {
            const query = value.slice(1).trim();
            const cmds = getCommands();
            // 精确匹配 → 直接执行
            const exact = cmds.find((c) => c.name === "/" + query);
            if (exact) {
                Promise.resolve(exact.handler()).catch((err) => {
                    addMessage(
                        MessageType.ERROR,
                        `Command failed: ${
                            err instanceof Error ? err.message : String(err)
                        }`
                    );
                });
                return;
            }
            // 部分匹配：唯一则自动执行，多个则提示用 Tab 补全
            const partial = cmds.filter((c) =>
                c.name.startsWith("/" + query.toLowerCase())
            );
            if (partial.length === 1) {
                Promise.resolve(partial[0].handler()).catch((err) => {
                    addMessage(
                        MessageType.ERROR,
                        `Command failed: ${
                            err instanceof Error ? err.message : String(err)
                        }`
                    );
                });
                return;
            }
            if (partial.length > 1) {
                addMessage(
                    MessageType.SYSTEM,
                    `Multiple commands match "/${query}". Press Tab to complete.`
                );
                return;
            }
            addMessage(MessageType.SYSTEM, `Unknown command: /${query}`);
            return;
        }

        if (!agentRef.current) {
            addMessage(
                MessageType.ERROR,
                "Agent not initialized. Please try again."
            );
            return;
        }

        addMessage(MessageType.USER, value);

        try {
            agentRef.current.submit(value);
        } catch (error) {
            addMessage(
                MessageType.ERROR,
                `Error submitting task: ${
                    error instanceof Error ? error.message : "Unknown error"
                }`
            );
        }
    };

    const getCommands = useCallback((): Command[] => {
        const service = serviceRef.current;
        const pk = pkRef.current;
        if (!service || !pk) return [];

        return [
            {
                name: "/resume",
                description: "Resume a previous session",
                handler: async () => {
                    const metas = await service.list(pk);
                    if (metas.length === 0) {
                        addMessage(MessageType.SYSTEM, "No sessions found.");
                        return;
                    }
                    if (metas.length === 1) {
                        // 只有一条，直接恢复
                        switchSession(metas[0].id);
                        return;
                    }
                    // 多条 → 进入选择
                    setSessionList(metas);
                    setSessionSelectMode(true);
                },
            },
            {
                name: "/help",
                description: "Show available commands",
                handler: () => {
                    addMessage(
                        MessageType.SYSTEM,
                        "Available commands:\n" +
                            "  /resume  - Resume a previous session\n" +
                            "  /help    - Show this help"
                    );
                },
            },
        ];
    }, [addMessage]);

    const switchSession = useCallback(
        (sessionId: string) => {
            setSessionSelectMode(false);
            setSessionList([]);
            // 交给 cli 层 unmount 旧 App + 重新 render 新 App。
            // 必须重建整个 Ink 实例：Ink 的 fullStaticOutput 是 append-only，
            // 同一实例内 <Static> 的旧 session 消息无法清除，会导致切换后旧对话仍残留。
            props.onSwitchSession?.(sessionId);
        },
        [props]
    );

    const handleSessionSelect = useCallback(
        (sessionId: string) => {
            switchSession(sessionId);
        },
        [switchSession]
    );

    const handleSessionCancel = useCallback(() => {
        setSessionSelectMode(false);
        setSessionList([]);
    }, []);

    return (
        <Box flexDirection="column" height="100%">
            {/*
             * <Static> 按 index 缓存已渲染 item，永不移除/重绘。切换 session 时若新 session
             * 消息更少，旧消息仍残留在缓存里、新消息追加其后 —— 这正是"切换后旧对话记录
             * 不消失"的根因。用 currentSessionId 作 key，切换时强制 remount 清空缓存。
             * 这里只放 Logo + 消息；交互组件（InputBox/SessionSelect）在实时区。
             */}
            <Static
                key={currentSessionId}
                items={[
                    <Logo key="logo" />,
                    ...messages.map((m) => (
                        <MessageItem key={m.id} message={m} />
                    )),
                ]}
            >
                {(item) => item}
            </Static>
            {/* 实时区：随 state 变化重渲染 */}
            {currentTaskText ? (
                <Box>
                    <Text>{currentTaskText}</Text>
                </Box>
            ) : null}
            {sessionSelectMode && (
                <SessionSelect
                    sessions={sessionList}
                    onSelect={handleSessionSelect}
                    onCancel={handleSessionCancel}
                />
            )}
            {streamingText ? (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="#10B981" bold>
                        {" "}
                        ● Assistant
                    </Text>
                    <Box paddingLeft={12}>
                        <Text>{streamingText}</Text>
                    </Box>
                </Box>
            ) : null}
            <InputBox
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                commands={getCommands()}
                active={!sessionSelectMode}
                placeholder={
                    isProcessing ? "Processing..." : "Type your message..."
                }
            />
        </Box>
    );
}
