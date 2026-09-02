import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ChatCompletionTool } from "openai/resources/index";
import type { Tool } from "./tools";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import type { Workspace } from "./workspace";
import { workspaceConfigDir } from "./workspace";

/**
 * MCP 真协议连接（FR-17 + AR-18）。
 *
 * - 连接池（AR-18）：连接按 server 配置指纹跨 run 复用（引用计数 + 空闲回收 +
 *   失活重建）；per-request agent 创建时 acquire、销毁时 release——首 token
 *   不再等 stdio spawn + 握手。空闲 5 分钟且无引用 → close。
 * - 工具命名空间（FR-17）：注册名为 `mcp__<server>__<tool>`，多 server 同名不再
 *   静默遮蔽；handler 内部映射回真实 tool 名。
 * - resources/prompts（FR-17）：server 暴露 resources 时注册 mcp_resources /
 *   mcp_read_resource；暴露 prompts 时注册 mcp_prompts（列举）。
 * - 自动重连（FR-17）：callTool 失败 → 标记失活 → 重连一次再试。
 */

/** 读项目级 <workspace>/.anycode/mcp.yaml（flat servers map），无文件 → 空 */
export function loadProjectMcp(workspace: Workspace): Record<string, McpServerConfig> {
    const file = join(workspaceConfigDir(workspace), "mcp.yaml");
    if (!existsSync(file)) return {};
    try {
        const parsed = yaml.load(readFileSync(file, "utf-8")) as
            | Record<string, McpServerConfig>
            | null;
        return parsed ?? {};
    } catch (e) {
        console.error("[MCP] Failed to parse project mcp.yaml:", e);
        return {};
    }
}
export interface StdioServerConfig {
    type: "stdio";
    command: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
    /** 显式启用控制（enabled:false 同 disabled:true；缺省 undefined=启用）。SPEC-031 B-007 */
    enabled?: boolean;
}
export interface SseServerConfig {
    type: "sse";
    url: string;
    headers?: Record<string, string>;
    disabled?: boolean;
    enabled?: boolean;
}
export type McpServerConfig =
    | StdioServerConfig
    | SseServerConfig
    | { type?: undefined; disabled?: boolean; enabled?: boolean };

/** MCP 连接管理器：工具集 + 清理函数（release，池化引用计数）。per-agent 语义保持。 */
export interface McpManager {
    tools: Tool[];
    cleanup: () => Promise<void>;
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
    name: string,
    mcpTool: { description?: string; inputSchema?: unknown }
): ChatCompletionTool {
    return {
        type: "function",
        function: {
            name,
            description: mcpTool.description ?? "",
            parameters:
                (mcpTool.inputSchema ?? { type: "object", properties: {} }) as never,
        },
    } as unknown as ChatCompletionTool;
}

// ── 连接（FR-17：重连；AR-18：池化单元）──

interface McpResource {
    uri: string;
    name?: string;
    description?: string;
}
interface McpPrompt {
    name: string;
    description?: string;
}

class McpConnection {
    readonly serverName: string;
    private readonly config: McpServerConfig;
    private client: Client | null = null;
    healthy = false;
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];
    resources: McpResource[] = [];
    prompts: McpPrompt[] = [];

    constructor(serverName: string, config: McpServerConfig) {
        this.serverName = serverName;
        this.config = config;
    }

    /** 配置指纹（池键）：同名不同配置 = 不同连接。 */
    static configKey(serverName: string, config: McpServerConfig): string {
        return `${serverName}::${JSON.stringify(config)}`;
    }

    async connect(): Promise<void> {
        const config = this.config;
        if (config.type !== "stdio" && config.type !== "sse") {
            throw new Error(`unknown server type`);
        }
        const client = new Client({
            name: `anycode-${this.serverName}`,
            version: "1.0.0",
        });
        let transport;
        if (config.type === "stdio") {
            transport = new StdioClientTransport({
                command: config.command,
                args: config.args,
                env: config.env,
            });
        } else {
            const headers = config.headers ?? {};
            transport = new SSEClientTransport(new URL(config.url), {
                // EventSourceInit 类型无 headers 字段，但 eventsource polyfill 运行时支持
                eventSourceInit: { headers } as never,
                requestInit: { headers },
            });
        }
        await client.connect(transport);
        this.client = client;
        const toolsResult = await client.listTools();
        this.tools = toolsResult.tools ?? [];
        // capabilities 探测（FR-17）：server 未实现时静默置空
        try {
            const rr = await client.listResources();
            this.resources = rr.resources ?? [];
        } catch {
            this.resources = [];
        }
        try {
            const pr = await client.listPrompts();
            this.prompts = pr.prompts ?? [];
        } catch {
            this.prompts = [];
        }
        this.healthy = true;
    }

    /** 确保已连接（失活 → 重连一次）。 */
    private async ensure(): Promise<Client> {
        if (!this.client || !this.healthy) {
            try {
                await this.client?.close();
            } catch {
                // 旧 client 关闭失败忽略
            }
            this.client = null;
            await this.connect();
        }
        return this.client!;
    }

    /** 工具调用；失败标记失活 → 重连一次再试（FR-17 自动重连）。 */
    async callTool(
        toolName: string,
        args: Record<string, unknown>
    ): Promise<{ content?: unknown; isError?: boolean }> {
        for (let i = 0; i < 2; i++) {
            try {
                const client = await this.ensure();
                const r = (await client.callTool({
                    name: toolName,
                    arguments: args,
                })) as { content?: unknown; isError?: boolean };
                this.healthy = true;
                return r;
            } catch (err) {
                this.healthy = false;
                this.client = null;
                if (i === 1) throw err;
            }
        }
        throw new Error("unreachable");
    }

    async readResource(
        uri: string
    ): Promise<{ content?: unknown; isError?: boolean }> {
        for (let i = 0; i < 2; i++) {
            try {
                const client = await this.ensure();
                return (await client.readResource({ uri })) as {
                    content?: unknown;
                    isError?: boolean;
                };
            } catch (err) {
                this.healthy = false;
                this.client = null;
                if (i === 1) throw err;
            }
        }
        throw new Error("unreachable");
    }

    async close(): Promise<void> {
        try {
            await this.client?.close();
        } catch {
            // 忽略
        }
        this.client = null;
        this.healthy = false;
    }
}

// ── 连接池（AR-18）──

interface PooledEntry {
    conn: McpConnection;
    refCount: number;
    lastUsed: number;
}

const IDLE_CLOSE_MS = 5 * 60_000;

const pool = new Map<string, PooledEntry>();

/** 空闲回收：无引用且超过 idleMs 未使用 → close（AR-18 空闲回收）。 */
export function closeIdleConnections(idleMs = IDLE_CLOSE_MS): void {
    const now = Date.now();
    for (const [key, entry] of pool) {
        if (entry.refCount <= 0 && now - entry.lastUsed >= idleMs) {
            void entry.conn.close();
            pool.delete(key);
        }
    }
}

// 惰性启动的清扫循环（unref：不阻止进程退出）
let sweeperStarted = false;
function ensureSweeper(): void {
    if (sweeperStarted) return;
    sweeperStarted = true;
    const t = setInterval(() => closeIdleConnections(), 60_000);
    t.unref?.();
}

/** 池状态（测试/诊断用）。 */
export function poolStats(): { size: number; refCounts: number[] } {
    return {
        size: pool.size,
        refCounts: [...pool.values()].map((e) => e.refCount),
    };
}

/** 测试辅助：清空池（强制 close）。 */
export async function resetPool(): Promise<void> {
    for (const entry of pool.values()) {
        await entry.conn.close();
    }
    pool.clear();
}

// ── resources/prompts 汇聚工具（FR-17）──

function resourceTools(handleConns: McpConnection[]): Tool[] {
    const tools: Tool[] = [];
    if (!handleConns.some((c) => c.resources.length > 0)) return tools;

    tools.push({
        schema: {
            type: "function",
            function: {
                name: "mcp_resources",
                description:
                    "List resources exposed by connected MCP servers (uri/name/description per server).",
                parameters: { type: "object", properties: {} },
            },
        } as unknown as ChatCompletionTool,
        handler: async () => {
            const lines: string[] = [];
            for (const c of handleConns) {
                for (const r of c.resources) {
                    lines.push(
                        `[${c.serverName}] ${r.uri}${r.name ? ` (${r.name})` : ""}${
                            r.description ? ` — ${r.description}` : ""
                        }`
                    );
                }
            }
            return lines.length
                ? lines.join("\n")
                : "当前连接的 MCP server 未暴露 resources。";
        },
        meta: { readOnly: true, concurrencySafe: true },
    });

    tools.push({
        schema: {
            type: "function",
            function: {
                name: "mcp_read_resource",
                description:
                    "Read an MCP resource by server and uri. Returns its text content.",
                parameters: {
                    type: "object",
                    properties: {
                        server: { type: "string", description: "MCP server name" },
                        uri: { type: "string", description: "Resource uri" },
                    },
                    required: ["server", "uri"],
                },
            },
        } as unknown as ChatCompletionTool,
        handler: async (args) => {
            const { server, uri } = args as { server?: string; uri?: string };
            const conn = handleConns.find((c) => c.serverName === server);
            if (!conn) return `[Error] MCP server ${server} 不在当前连接集中`;
            try {
                const r = await conn.readResource(uri!);
                const text = extractText(r.content);
                return r.isError ? `[Error] ${text}` : text;
            } catch (err) {
                return `[Error] MCP readResource failed: ${(err as Error).message}`;
            }
        },
        meta: { readOnly: true, concurrencySafe: true },
    });

    return tools;
}

function promptsTool(handleConns: McpConnection[]): Tool | null {
    if (!handleConns.some((c) => c.prompts.length > 0)) return null;
    return {
        schema: {
            type: "function",
            function: {
                name: "mcp_prompts",
                description:
                    "List prompts exposed by connected MCP servers (server/name/description).",
                parameters: { type: "object", properties: {} },
            },
        } as unknown as ChatCompletionTool,
        handler: async () => {
            const lines: string[] = [];
            for (const c of handleConns) {
                for (const p of c.prompts) {
                    lines.push(
                        `[${c.serverName}] ${p.name}${p.description ? ` — ${p.description}` : ""}`
                    );
                }
            }
            return lines.join("\n");
        },
        meta: { readOnly: true, concurrencySafe: true },
    };
}

/**
 * 对每个 MCP server acquire 池化连接（AR-18：跨 run 复用），工具注册名带
 * server 命名空间（FR-17：`mcp__<server>__<tool>`）。单 server 失败不阻断其余。
 * cleanup = release（引用计数减一，空闲后由清扫循环关闭）。
 */
export async function loadMcpTools(
    mcpServers: Record<string, McpServerConfig>
): Promise<McpManager> {
    ensureSweeper();
    const tools: Tool[] = [];
    const handleConns: McpConnection[] = [];
    const acquiredKeys: string[] = [];

    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
        // 既有 disabled 字段 + 新 enabled:false 双语义（SPEC-031 AC-008）：保留定义、运行时不建连。
        if (serverConfig.disabled || serverConfig.enabled === false) continue;
        if (serverConfig.type !== "stdio" && serverConfig.type !== "sse") {
            // 要求 type 字段；无 type 的旧格式不识别，跳过记错
            console.error(
                `[MCP] server "${serverName}" missing/unknown type, skipped`
            );
            continue;
        }
        const key = McpConnection.configKey(serverName, serverConfig);
        try {
            let entry = pool.get(key);
            if (!entry || !entry.conn.healthy) {
                // 失活/不存在 → 重建（AR-18 失活重建）
                if (entry) {
                    await entry.conn.close();
                    pool.delete(key);
                }
                const conn = new McpConnection(serverName, serverConfig);
                await conn.connect();
                entry = { conn, refCount: 0, lastUsed: Date.now() };
                pool.set(key, entry);
            }
            entry.refCount += 1;
            entry.lastUsed = Date.now();
            acquiredKeys.push(key);
            handleConns.push(entry.conn);
        } catch (err) {
            // 单 server 失败不阻断其余
            console.error(
                `[MCP] failed to connect server "${serverName}":`,
                err
            );
        }
    }

    // 工具注册：命名空间 mcp__<server>__<tool>（FR-17，防多 server 同名遮蔽）
    for (const conn of handleConns) {
        for (const mcpTool of conn.tools) {
            const qualified = `mcp__${conn.serverName}__${mcpTool.name}`;
            tools.push({
                schema: toOpenAiTool(qualified, mcpTool),
                handler: async (args) => {
                    try {
                        const result = await conn.callTool(
                            mcpTool.name,
                            args as Record<string, unknown>
                        );
                        const text = extractText(
                            (result as { content?: unknown }).content
                        );
                        return (result as { isError?: boolean }).isError
                            ? `[Error] ${text}`
                            : text;
                    } catch (err) {
                        // 调用失败回传错误内容，不抛异常（与 toolCall 未知工具一致，模型自纠）
                        return `[Error] MCP tool ${qualified} failed: ${
                            (err as Error).message
                        }`;
                    }
                },
                // MCP 工具未知语义：保守元数据（非只读、非并发安全，AR-7）
                meta: { readOnly: false, concurrencySafe: false },
            });
        }
    }

    tools.push(...resourceTools(handleConns));
    const prompts = promptsTool(handleConns);
    if (prompts) tools.push(prompts);

    return {
        tools,
        cleanup: async () => {
            for (const key of acquiredKeys) {
                const entry = pool.get(key);
                if (entry) {
                    entry.refCount = Math.max(0, entry.refCount - 1);
                    entry.lastUsed = Date.now();
                }
            }
        },
    };
}
