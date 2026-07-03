import React from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export interface Command {
    name: string;
    description: string;
    handler: () => void;
}

interface InputBoxProps {
    onSubmit: (value: string) => void;
    onCancel: () => void;
    /** 可用指令，输入 / 时内联展示候选 */
    commands?: Command[];
    placeholder?: string;
    /** sessionSelectMode 等overlay 激活时设为 false，让出键盘 */
    active?: boolean;
}

export default function InputBox({
    onSubmit,
    onCancel,
    commands = [],
    placeholder = "Type your message...",
    active = true,
}: InputBoxProps) {
    const [value, setValue] = React.useState("");
    const [highlightedIndex, setHighlightedIndex] = React.useState(0);

    const isCommand = value.startsWith("/");
    const matches = React.useMemo(() => {
        if (!isCommand) return [];
        const v = value.toLowerCase();
        return commands.filter((c) => c.name.toLowerCase().startsWith(v));
    }, [value, commands, isCommand]);

    // 输入变化时重置高亮到首项
    React.useEffect(() => {
        setHighlightedIndex(0);
    }, [value]);

    // TextInput 内部已忽略 ↑↓/Tab/Ctrl+C（early return），这里安全接管：
    //   ↑↓ 切换高亮、Tab 补全到高亮项、Esc/Ctrl+C 取消
    useInput(
        (input, key) => {
            if (!active) return;
            if (key.escape || (key.ctrl && input === "c")) {
                onCancel();
                return;
            }
            if (!isCommand || matches.length === 0) return;
            if (key.tab) {
                const m = matches[highlightedIndex] ?? matches[0];
                if (m) setValue(m.name);
                return;
            }
            if (key.upArrow) {
                setHighlightedIndex(
                    (prev) => (prev - 1 + matches.length) % matches.length
                );
            }
            if (key.downArrow) {
                setHighlightedIndex((prev) => (prev + 1) % matches.length);
            }
        },
        { isActive: active }
    );

    const handleSubmit = () => {
        const v = value.trim();
        if (!v) return;
        onSubmit(v);
        setValue("");
    };

    return (
        <Box flexDirection="column">
            {isCommand && matches.length > 0 && (
                <Box flexDirection="column">
                    {matches.map((c, i) => {
                        const isHighlighted = i === highlightedIndex;
                        return (
                            <Box key={c.name}>
                                <Text
                                    color={isHighlighted ? "#000" : "#4ECDC4"}
                                    bold={isHighlighted}
                                    inverse={isHighlighted}
                                >
                                    {"  "}
                                    {c.name}
                                </Text>
                                {isHighlighted && (
                                    <Text color="#000" bold inverse>
                                        {" "}
                                        {c.description}
                                    </Text>
                                )}
                            </Box>
                        );
                    })}
                </Box>
            )}
            <Box marginTop={1}>
                <Text color="#4ECDC4" bold>
                    {">"}{" "}
                </Text>
                {active ? (
                    <TextInput
                        value={value}
                        onChange={setValue}
                        onSubmit={handleSubmit}
                        placeholder={placeholder}
                    />
                ) : (
                    <Text color="#9CA3AF" dimColor>
                        {placeholder}
                    </Text>
                )}
            </Box>
        </Box>
    );
}
