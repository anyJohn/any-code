import React from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMeta } from "@any-code/domain";

interface SessionSelectProps {
    sessions: SessionMeta[];
    onSelect: (sessionId: string) => void;
    onCancel: () => void;
}

export default function SessionSelect({
    sessions,
    onSelect,
    onCancel,
}: SessionSelectProps) {
    const [highlightedIndex, setHighlightedIndex] = React.useState(0);

    useInput((_input, key) => {
        if (key.escape) {
            onCancel();
            return;
        }
        if (key.return) {
            if (sessions.length > 0) {
                onSelect(sessions[highlightedIndex].id);
            }
            return;
        }
        if (key.upArrow) {
            if (sessions.length > 0) {
                setHighlightedIndex(
                    (prev) => (prev - 1 + sessions.length) % sessions.length
                );
            }
        }
        if (key.downArrow) {
            if (sessions.length > 0) {
                setHighlightedIndex((prev) => (prev + 1) % sessions.length);
            }
        }
    });

    if (sessions.length === 0) {
        return (
            <Box>
                <Text color="#6B7280">No sessions found for this project.</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            <Box>
                <Text color="#6B7280" dimColor>
                    Select a session to resume:
                </Text>
            </Box>
            {sessions.map((s, i) => {
                const isHighlighted = i === highlightedIndex;
                const when = new Date(s.updatedAt).toLocaleString();
                return (
                    <Box key={s.id}>
                        <Text
                            color={isHighlighted ? "#000" : "#4ECDC4"}
                            bold={isHighlighted}
                            inverse={isHighlighted}
                        >
                            {isHighlighted ? "▸ " : "  "}
                            {s.title}
                        </Text>
                        {isHighlighted && (
                            <Text color="#000" dimColor bold inverse>
                                {" "}
                                {when}
                            </Text>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
}
