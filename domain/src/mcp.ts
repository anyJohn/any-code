import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ChatCompletionTool } from "openai/resources/index";
import type { Workspace } from "./workspace";
import { workspaceConfigDir } from "./workspace";
import type { Tool } from "./tools";

/**
 * MCP 真协议连接。
 * 配置在 <workspace>/.anycode/mcp.json，每个 server 一个对象：
 *   { type: "stdio", command, args?, env? }
 *   { type: "sse", url, headers? }
 * 连接 per-agent：AnyAgent.create 时建连，destroy 时 cleanup。
 * 用官方 @modelcontextprotocol/sdk v1。v2 @modelcontextprotocol/client 留未来迁移。
 */

interface StdioServerConfig {
    type: "stdio";
    command: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
}
interface SseServerConfig {
    type: "sse";
    url: string;
    headers?: Record<string, string>;
    disabled?: boolean;
}
type ServerConfig = StdioServerConfig | SseServerConfig | { type?: undefined; disabled?: boolean };

/** MCP 连接管理器：工具集 + 清理函数。per-agent 生命周期绑定。 */
export interface McpManager {
    tools: Tool[];
    cleanup: () => Promise<void>;
}

function mcpConfigPath(workspace: Workspace): string {
    return path.join(workspaceConfigDir(workspace), "mcp.json");
}

/** 确保配置文件存在（父目录一并创建）。无文件则建空 {}。 */
function ensureMcpConfig(workspace: Workspace): void {
    const file = mcpConfigPath(workspace);
    if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({}), "utf-8");
    }
}

/** 从 callTool 结果 content 提取文本（text 段拼接；isError 由调用方前缀）。 */
function extractText(content: unknown): string {
    if (!Array.isArray(content)) return JSON.stringify(content ?? "");
    const parts: string[] = [];
    for (const item of content) {
        if (
            item &&
            typeof item === "object" &&
            (item as { type?: string }).type === "text"
        ) {
            parts.push((item as { text?: string }).text ?? "");
        }
    }
    return parts.length ? parts.join("\n") : JSON.stringify(content);
}

/** 把 MCP 工具 schema（name/description/inputSchema）转 OpenAI ChatCompletionTool。 */
function toOpenAiTool(
    mcpTool: { name: string; description?: string; inputSchema?: unknown }
): ChatCompletionTool {
    return {
        type: "function",
        function: {
            name: mcpTool.name,
            description: mcpTool.description ?? "",
            parameters:
                (mcpTool.inputSchema ?? { type: "object", properties: {} }) as never,
        },
    } as unknown as ChatCompletionTool;
}

/**
 * 读 mcp.json 并对每个 server 建真连接（stdio spawn / SSE HTTP），
 * listTools 拿工具 schema，包装成 Tool（handler 经 call_tool 转发）。
 * 单 server 失败不阻断其余。返回 tools + cleanup。
 */
export async function loadMcpTools(workspace: Workspace): Promise<McpManager> {
    ensureMcpConfig(workspace);
    const tools: Tool[] = [];
    const cleanups: Array<() => Promise<void>> = [];

    let config: Record<string, ServerConfig>;
    try {
        const fileContent = fs.readFileSync(mcpConfigPath(workspace), "utf-8");
        config = JSON.parse(fileContent);
    } catch (error) {
        console.error("[MCP] Failed to parse MCP config:", error);
        return { tools, cleanup: async () => {} };
    }

    for (const [serverName, serverConfig] of Object.entries(config)) {
        if (serverConfig.disabled) continue;
        if (serverConfig.type !== "stdio" && serverConfig.type !== "sse") {
            // 新格式要求 type 字段；旧静态 schema 格式（无 type）不识别，跳过记错
            console.error(
                `[MCP] server "${serverName}" missing/unknown type, skipped`
            );
            continue;
        }
        try {
            const client = new Client({
                name: `anycode-${serverName}`,
                version: "1.0.0",
            });
            let transport;
            if (serverConfig.type === "stdio") {
                transport = new StdioClientTransport({
                    command: serverConfig.command,
                    args: serverConfig.args,
                    env: serverConfig.env,
                });
            } else {
                const headers = serverConfig.headers ?? {};
                transport = new SSEClientTransport(new URL(serverConfig.url), {
                    // EventSourceInit 类型无 headers 字段，但 eventsource polyfill 运行时支持
                    eventSourceInit: { headers } as never,
                    requestInit: { headers },
                });
            }
            await client.connect(transport);
            cleanups.push(() => client.close().catch(() => {}));
            const toolsResult = await client.listTools();
            for (const mcpTool of toolsResult.tools ?? []) {
                const toolName = mcpTool.name;
                tools.push({
                    schema: toOpenAiTool(mcpTool),
                    handler: async (args) => {
                        try {
                            const result = await client.callTool({
                                name: toolName,
                                arguments: args as Record<string, unknown>,
                            });
                            const text = extractText(
                                (result as { content?: unknown }).content
                            );
                            return (result as { isError?: boolean }).isError
                                ? `[Error] ${text}`
                                : text;
                        } catch (err) {
                            // 调用失败回传错误内容，不抛异常（与 toolCall 未知工具一致，模型自纠）
                            return `[Error] MCP tool ${toolName} failed: ${
                                (err as Error).message
                            }`;
                        }
                    },
                });
            }
        } catch (err) {
            // 单 server 失败不阻断其余
            console.error(
                `[MCP] failed to connect server "${serverName}":`,
                err
            );
        }
    }

    return {
        tools,
        cleanup: async () => {
            for (const c of cleanups) {
                await c();
            }
        },
    };
}
