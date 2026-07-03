import fs from "fs";
import { ChatCompletionTool } from "openai/resources/index";
import path from "path";
import type { Workspace } from "./workspace";
import { workspaceConfigDir } from "./workspace";

/**
 * MCP 配置在 <workspace>/.anycode/mcp.json。每个工作区独立配置。
 */
function mcpConfigPath(workspace: Workspace): string {
    return path.join(workspaceConfigDir(workspace), "mcp.json");
}

/** 确保配置文件存在（父目录一并创建） */
function ensureMcpConfig(workspace: Workspace): void {
    const file = mcpConfigPath(workspace);
    if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({}), "utf-8");
    }
}

export function loadMcpTools(workspace: Workspace): ChatCompletionTool[] {
    ensureMcpConfig(workspace);
    try {
        const mcpTools: ChatCompletionTool[] = [];
        const fileContent = fs.readFileSync(mcpConfigPath(workspace), "utf-8");
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
