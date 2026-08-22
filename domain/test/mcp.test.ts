import { describe, it, expect, vi, beforeEach } from "vitest";
import { toolCall } from "../src/tools/toolCall";
import { EventType } from "../src/type";
import type { ToolContext } from "../src/context";
import type { McpServerConfig } from "../src/mcp";

// vi.hoisted：mock 工厂能引用到的可变状态（在 vi.mock 之前求值）
const mocks = vi.hoisted(() => {
    const state = {
        clients: [] as Array<{
            connect: ReturnType<typeof vi.fn>;
            listTools: ReturnType<typeof vi.fn>;
            callTool: ReturnType<typeof vi.fn>;
            close: ReturnType<typeof vi.fn>;
        }>,
        stdioTransports: [] as unknown[],
        sseTransports: [] as unknown[],
        listToolsResult: { tools: [] } as { tools: unknown[] },
        failConnectOn: null as number | null,
    };
    const mkClient = () => {
        const idx = state.clients.length;
        const inst = {
            connect: vi.fn(async () => {
                if (state.failConnectOn === idx) {
                    throw new Error("connect-fail");
                }
            }),
            listTools: vi.fn(async () => state.listToolsResult),
            callTool: vi.fn(async () => ({
                content: [{ type: "text", text: "ok" }],
            })),
            close: vi.fn(async () => {}),
        };
        state.clients.push(inst);
        return inst;
    };
    return { state, mkClient };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
    Client: vi.fn().mockImplementation(() => mocks.mkClient()),
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
    StdioClientTransport: vi.fn().mockImplementation((opts: unknown) => {
        const t = { opts };
        mocks.state.stdioTransports.push(t);
        return t;
    }),
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
    SSEClientTransport: vi.fn().mockImplementation((url: unknown, opts: unknown) => {
        const t = { url, opts };
        mocks.state.sseTransports.push(t);
        return t;
    }),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { loadMcpTools } from "../src/mcp";

const mkCtx = (): ToolContext => ({
    workspace: {} as never,
    eventStream: { submit: vi.fn() },
    signal: new AbortController().signal,
});

const resetState = () => {
    mocks.state.clients.length = 0;
    mocks.state.stdioTransports.length = 0;
    mocks.state.sseTransports.length = 0;
    mocks.state.listToolsResult = { tools: [] };
    mocks.state.failConnectOn = null;
};

describe("MCP 真协议连接（mcp.ts / SPEC-006，配置从 config.yaml mcp 段来）", () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it("AC-001 stdio server 建连 + listTools 工具注册成 Tool", async () => {
        mocks.state.listToolsResult = {
            tools: [
                {
                    name: "foo",
                    description: "do foo",
                    inputSchema: { type: "object", properties: {} },
                },
            ],
        };
        const servers: Record<string, McpServerConfig> = {
            srv: { type: "stdio", command: "node", args: ["s.js"], env: { X: "1" } },
        };
        const manager = await loadMcpTools(servers);

        expect(StdioClientTransport).toHaveBeenCalledOnce();
        expect(mocks.state.stdioTransports[0]).toMatchObject({
            opts: { command: "node", args: ["s.js"], env: { X: "1" } },
        });
        expect(mocks.state.clients[0].connect).toHaveBeenCalledOnce();
        expect(mocks.state.clients[0].listTools).toHaveBeenCalledOnce();
        expect(manager.tools).toHaveLength(1);
        expect(manager.tools[0].schema).toMatchObject({
            type: "function",
            function: { name: "foo", description: "do foo" },
        });
    });

    it("AC-002 SSE server 建连（url + headers）", async () => {
        const servers: Record<string, McpServerConfig> = {
            srv: { type: "sse", url: "http://x/sse", headers: { Authorization: "Bearer t" } },
        };
        await loadMcpTools(servers);

        expect(SSEClientTransport).toHaveBeenCalledOnce();
        const t = mocks.state.sseTransports[0] as { url: URL; opts: unknown };
        expect(t.url.toString()).toBe("http://x/sse");
        expect(t.opts).toMatchObject({
            eventSourceInit: { headers: { Authorization: "Bearer t" } },
            requestInit: { headers: { Authorization: "Bearer t" } },
        });
        expect(mocks.state.clients[0].connect).toHaveBeenCalledOnce();
    });

    it("AC-003 handler 经 callTool 转发；成功返回 text，失败/异常回传 [Error] 不抛", async () => {
        mocks.state.listToolsResult = {
            tools: [{ name: "foo", description: "", inputSchema: {} }],
        };
        const manager = await loadMcpTools({ srv: { type: "stdio", command: "node" } });
        const handler = manager.tools[0].handler;
        const client = mocks.state.clients[0];

        client.callTool.mockResolvedValue({
            content: [{ type: "text", text: "result" }],
        });
        await expect(handler({ x: 1 })).resolves.toBe("result");
        expect(client.callTool).toHaveBeenCalledWith({
            name: "foo",
            arguments: { x: 1 },
        });

        client.callTool.mockResolvedValue({
            content: [{ type: "text", text: "bad" }],
            isError: true,
        });
        await expect(handler({})).resolves.toBe("[Error] bad");

        client.callTool.mockRejectedValue(new Error("boom"));
        await expect(handler({})).resolves.toBe("[Error] MCP tool foo failed: boom");
    });

    it("AC-004 cleanup 关闭所有已连 client", async () => {
        const manager = await loadMcpTools({
            a: { type: "stdio", command: "node" },
            b: { type: "stdio", command: "node" },
        });
        await manager.cleanup();
        expect(mocks.state.clients[0].close).toHaveBeenCalledOnce();
        expect(mocks.state.clients[1].close).toHaveBeenCalledOnce();
    });

    it("AC-005 新格式按 type 选 transport；无 type 的旧格式跳过", async () => {
        await loadMcpTools({
            good: { type: "stdio", command: "node" },
            legacy: { command: "node", schema: {} } as never,
        });
        expect(StdioClientTransport).toHaveBeenCalledOnce();
        expect(mocks.state.clients).toHaveLength(1);
    });

    it("AC-006 空 mcp 配置 → 仅内置工具，不报错", async () => {
        const manager = await loadMcpTools({});
        expect(manager.tools).toHaveLength(0);
        await expect(manager.cleanup()).resolves.toBeUndefined();
    });

    it("AC-007 MCP 工具经 toolCall 执行，照常提交 TOOL 事件", async () => {
        mocks.state.listToolsResult = {
            tools: [{ name: "foo", description: "", inputSchema: {} }],
        };
        const manager = await loadMcpTools({ srv: { type: "stdio", command: "node" } });

        const ctx = mkCtx();
        const result = await toolCall(
            [{ id: "tc1", type: "function", function: { name: "foo", arguments: "{}" } }],
            ctx,
            manager.tools,
            "t1"
        );
        expect(result[0]).toMatchObject({ role: "tool", content: "ok", tool_call_id: "tc1" });
        expect(ctx.eventStream.submit).toHaveBeenCalledOnce();
        const evt = (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(evt).toMatchObject({
            type: EventType.TOOL,
            message: "foo",
            data: { name: "foo", args: {}, result: "ok" },
            turnId: "t1",
        });
    });

    it("AC-008 单 server 连接失败不阻断其余 server", async () => {
        mocks.state.failConnectOn = 0;
        mocks.state.listToolsResult = {
            tools: [{ name: "bar", description: "", inputSchema: {} }],
        };
        const manager = await loadMcpTools({
            a: { type: "stdio", command: "node" },
            b: { type: "stdio", command: "node" },
        });

        expect(manager.tools).toHaveLength(1);
        expect(manager.tools[0].schema.function.name).toBe("bar");
        await manager.cleanup();
        expect(mocks.state.clients[0].close).not.toHaveBeenCalled();
        expect(mocks.state.clients[1].close).toHaveBeenCalledOnce();
    });
});
