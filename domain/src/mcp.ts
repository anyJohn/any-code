import fs from "fs";
import { ChatCompletionTool } from "openai/resources/index";
import path from "path";
const MCP_CONFIG = path.join(__dirname, "..", "/.agent/mcp.json");

/**
 * 确保MCP配置文件存在
 */
function ensureMcpConfig(): void {
    if (!fs.existsSync(MCP_CONFIG)) {
        fs.writeFileSync(MCP_CONFIG, JSON.stringify({}), "utf-8");
    }
}

export function loadMcpTools(): ChatCompletionTool[] {
    ensureMcpConfig();
    try {
        const mcpTools: ChatCompletionTool[] = [];
        const fileContent = fs.readFileSync(MCP_CONFIG, "utf-8");
        const mcpConfig = JSON.parse(fileContent);
        Object.keys(mcpConfig).forEach((serverName) => {
            const serverConfig = mcpConfig[serverName];
            if (!serverConfig.disabled) {
                mcpTools.push(serverConfig);
            }
        });
        return mcpTools;
    } catch (error) {
        console.error("Failed to parse MCP config:", error);
        return [];
    }
}
