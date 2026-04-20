import React from "react";
import { Box, Text } from "ink";
import figlet from "figlet";
const banner = figlet.textSync("ANY CODE", {
    font: "ANSI Shadow",
    horizontalLayout: "default",
    verticalLayout: "default",
});

export default function Logo() {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text color="#f0f0f0" bold>
                {banner}
            </Text>
            <Box paddingLeft={12}>
                <Text color="#4ECDC4">{"</>  "}ANY CODE - A Code Agent</Text>
            </Box>
        </Box>
    );
}
