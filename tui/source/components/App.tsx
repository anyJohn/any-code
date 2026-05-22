import React, { useEffect, useRef, useCallback } from "react";
import { Box, Text, useApp, Static } from "ink";
import Logo from "./Logo";
import { MessageItem } from "./MessageList";
import InputBox from "./InputBox";
import { Message, MessageType } from "../types";
import { AnyAgent, EventType } from "@any-code/domain";

interface AppProps {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}

let messageIdCounter = 0;

export default function App(props: AppProps) {
    const { exit } = useApp();
    const [messages, setMessages] = React.useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = React.useState(false);
    const agentRef = useRef<AnyAgent | null>(null);
    const subscriptionsRef = useRef<Array<{ unsubscribe: () => void }>>([]);
    const currentTaskRef = useRef<string>("");
    const initializedRef = useRef(false);

    // Apply CLI config overrides to env vars before agent init
    if (props.apiKey) process.env.OPENAI_API_KEY = props.apiKey;
    if (props.baseUrl) process.env.OPENAI_BASE_URL = props.baseUrl;
    if (props.model) process.env.OPENAI_MODEL = props.model;
    // Map domain EventType to TUI MessageType
    const mapEventType = useCallback((eventType: EventType): MessageType => {
        const eventTypeMap: Record<EventType, MessageType> = {
            [EventType.SYSTEM]: MessageType.SYSTEM,
            [EventType.USER]: MessageType.USER,
            [EventType.TOOL]: MessageType.TOOL,
            [EventType.ITERATION]: MessageType.ITERATION,
            [EventType.ASSISTANT]: MessageType.ASSISTANT,
            [EventType.PLANNING]: MessageType.PLANNING,
            [EventType.ERROR]: MessageType.ERROR,
        };
        return eventTypeMap[eventType] || MessageType.SYSTEM;
    }, []);

    const addMessage = useCallback(
        (type: MessageType, content: string, data?: any) => {
            messageIdCounter += 1;
            const newMessage: Message = {
                id: `msg-${messageIdCounter}`,
                type,
                content,
                timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, newMessage]);

            // If there's data, add it as a separate message
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

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        // Initialize agent
        const agent = new AnyAgent();
        agentRef.current = agent;

        // Subscribe to agent's event stream
        const eventSubscription = agent.eventStream$.subscribe({
            next: (event) => {
                addMessage(mapEventType(event.type), event.message, event.data);
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
            currentTaskRef.current =
                tasks.length > 0 ? "✻ Current Task: " + tasks[0] : "";
        });
        subscriptionsRef.current.push(taskSubscription);
        setIsProcessing(false);
        messageIdCounter = 2;

        // Cleanup on unmount only
        return () => {
            subscriptionsRef.current.forEach((sub) => sub.unsubscribe());
            subscriptionsRef.current = [];
            agent.stop();
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

        if (!agentRef.current) {
            addMessage(
                MessageType.ERROR,
                "Agent not initialized. Please try again."
            );
            return;
        }

        // Add user message
        addMessage(MessageType.USER, value);

        // Submit task to agent
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

    return (
        <Box flexDirection="column" height="100%">
            <Static
                items={[
                    <Logo key="logo" />,
                    ...messages.map((m) => (
                        <MessageItem key={m.id} message={m} />
                    )),
                ]}
            >
                {(item) => item}
            </Static>
            <Box>
                <Text>{currentTaskRef.current}</Text>
            </Box>
            <InputBox
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                placeholder={
                    isProcessing ? "Processing..." : "Type your message..."
                }
            />
        </Box>
    );
}
