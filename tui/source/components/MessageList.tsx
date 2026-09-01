import React from "react";
import { Box, Text } from "ink";
import { Message, MessageType } from "../types";

interface MessageListProps {
    messages: Message[];
    showTimestamp?: boolean;
}

const TYPE_COLORS: Record<MessageType, string> = {
    [MessageType.SYSTEM]: "#6B7280",
    [MessageType.USER]: "#3B82F6",
    [MessageType.TOOL]: "#8B5CF6",
    [MessageType.ITERATION]: "#6B7280",
    [MessageType.ASSISTANT]: "#10B981",
    [MessageType.PLANNING]: "#F59E0B",
    [MessageType.ERROR]: "#EF4444",
};

const TYPE_ICONS: Record<MessageType, string> = {
    [MessageType.SYSTEM]: "●",
    [MessageType.USER]: "●",
    [MessageType.TOOL]: "◈",
    [MessageType.ITERATION]: "↺",
    [MessageType.ASSISTANT]: "●",
    [MessageType.PLANNING]: "◆",
    [MessageType.ERROR]: "✖",
};

function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
}

interface MessageItemProps {
    message: Message;
    showTimestamp?: boolean;
}

export function MessageItem({
    message,
    showTimestamp = true,
}: MessageItemProps) {
    const color = TYPE_COLORS[message.type];
    const icon = TYPE_ICONS[message.type];
    const timestamp = showTimestamp ? formatTimestamp(message.timestamp) : "";

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                {showTimestamp && (
                    <Text color="#9CA3AF" dimColor>
                        [{timestamp}]
                    </Text>
                )}
                <Text color={color} bold>
                    {" "}
                    {icon} {message.type}
                </Text>
            </Box>
            <Box paddingLeft={showTimestamp ? 12 : 0}>
                <Text>{message.content}</Text>
            </Box>
        </Box>
    );
}

export function MessageList({
    messages,
    showTimestamp = true,
}: MessageListProps) {
    return (
        <>
            {messages.map((message) => (
                <MessageItem
                    key={message.id}
                    message={message}
                    showTimestamp={showTimestamp}
                />
            ))}
        </>
    );
}
