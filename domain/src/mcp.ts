import fs from "fs";
import { ChatCompletionTool } from "openai/resources/index";
import path from "path";

/**
 * MCP 配置相对用户项目根目录（cwd）解析，与 config.ts 的 .env 加载逻辑一致。
 * 之前用 import.meta.url 推导 __dirname 会指向 domain 包目录，导致
 * `<repo>/.agent/mcp.json` 永远读不到。
 */
const MCP_CONFIG = path.join(process.cwd(), ".agent", "mcp.json");

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
