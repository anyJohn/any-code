import React from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface InputBoxProps {
	onSubmit: (value: string) => void;
	onCancel: () => void;
	placeholder?: string;
}

export default function InputBox({
	onSubmit,
	onCancel,
	placeholder = "Type your message...",
}: InputBoxProps) {
	const [value, setValue] = React.useState("");

	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === "c")) {
			onCancel();
		}
	});

	const handleSubmit = () => {
		if (value.trim()) {
			onSubmit(value.trim());
			setValue("");
		}
	};

	return (
		<Box marginTop={1}>
			<Text color="#4ECDC4" bold>
				{">"}{" "}
			</Text>
			<TextInput
				value={value}
				onChange={setValue}
				onSubmit={handleSubmit}
				placeholder={placeholder}
			/>
		</Box>
	);
}
