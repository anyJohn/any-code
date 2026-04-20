import React, { useEffect } from "react";
import { Box, useApp } from "ink";
import Logo from "./Logo";
import MessageList from "./MessageList";
import InputBox from "./InputBox";
import { Message, MessageType } from "../types";

interface AppProps {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}

export default function App({ apiKey, baseUrl, model }: AppProps) {
    const { exit } = useApp();
    const [messages, setMessages] = React.useState<Message[]>([]);
    const [initialized, setInitialized] = React.useState(false);
    const [isProcessing, setIsProcessing] = React.useState(false);

    useEffect(() => {
        if (!initialized) {
            const welcomeMessages: Message[] = [
                {
                    id: "1",
                    type: MessageType.SYSTEM,
                    content:
                        "AnyCode is ready to assist you with your coding tasks.",
                    timestamp: Date.now(),
                },
                {
                    id: "2",
                    type: MessageType.SYSTEM,
                    content:
                        "Type your message and press Enter to send. Press Esc or Ctrl+C to exit.",
                    timestamp: Date.now() + 1,
                },
            ];
            setMessages(welcomeMessages);
            setInitialized(true);
        }
    }, [initialized]);

    const addMessage = (type: MessageType, content: string) => {
        const newMessage: Message = {
            id: Date.now().toString(),
            type,
            content,
            timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, newMessage]);
    };

    const handleCancel = () => {
        addMessage(MessageType.SYSTEM, "Task cancelled by user.");
        setTimeout(() => {
            exit();
        }, 500);
    };

    const handleSubmit = async (value: string) => {
        if (isProcessing) {
            addMessage(
                MessageType.ERROR,
                "Please wait for the current task to complete."
            );
            return;
        }

        addMessage(MessageType.USER, value);
        setIsProcessing(true);

        addMessage(MessageType.SYSTEM, "Sending message to Agent...");

        try {
            // TODO: 这里需要调用 domain 包的 agent 函数
            // 目前是模拟实现
            await new Promise((resolve) => setTimeout(resolve, 1000));

            addMessage(
                MessageType.ASSISTANT,
                "This is a placeholder response. In the full implementation, this would call the domain agent."
            );
        } catch (error) {
            addMessage(
                MessageType.ERROR,
                `Error: ${
                    error instanceof Error ? error.message : "Unknown error"
                }`
            );
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <Box flexDirection="column" height="100%">
            <Box flexGrow={1} flexDirection="column" paddingX={1}>
                <Logo />
                <MessageList messages={messages} />
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
