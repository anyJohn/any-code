import { describe, it, expect, vi, beforeEach } from "vitest";
import { toolCall } from "../src/tools/toolCall";
import { EventType } from "../src/type";
import type { ToolContext } from "../src/context";
import type { McpServerConfig } from "../src/mcp";
import { closeIdleConnections, resetPool } from "../src/mcp";

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
        callToolFailMsg: null as string | null,
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
            callTool: vi.fn(async () => {
                if (state.callToolFailMsg !== null) {
                    throw new Error(state.callToolFailMsg);
                }
                return { content: [{ type: "text", text: "ok" }] };
            }),
            close: vi.fn(async () => {}),
        };
        state.clients.push(inst);
        return inst;
    };
    return { state, mkClient };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
    Client: vi.fn().mockImplementation(function () {
        return mocks.mkClient();
    }),
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
    StdioClientTransport: vi.fn().mockImplementation(function (opts: unknown) {
        const t = { opts };
        mocks.state.stdioTransports.push(t);
        return t;
    }),
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
    SSEClientTransport: vi
        .fn()
        .mockImplementation(function (url: unknown, opts: unknown) {
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
    beforeEach(async () => {
        resetState();
        vi.clearAllMocks();
        await resetPool();
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
            srv: {
                type: "stdio",
                command: "node",
                args: ["s.js"],
                env: { X: "1" },
            },
        };
        const manager = await loadMcpTools(servers);

        expect(StdioClientTransport).toHaveBeenCalledOnce();
        expect(mocks.state.stdioTransports[0]).toMatchObject({
            opts: { command: "node", args: ["s.js"], env: { X: "1" } },
        });
        expect(mocks.state.clients[0].connect).toHaveBeenCalledOnce();
        expect(mocks.state.clients[0].listTools).toHaveBeenCalledOnce();
        expect(manager.tools).toHaveLength(1);
        // FR-17：注册名带 server 命名空间（防多 server 同名遮蔽）
        expect(manager.tools[0].schema).toMatchObject({
            type: "function",
            function: { name: "mcp__srv__foo", description: "do foo" },
        });
    });

    it("AC-002 SSE server 建连（url + headers）", async () => {
        const servers: Record<string, McpServerConfig> = {
            srv: {
                type: "sse",
                url: "http://x/sse",
                headers: { Authorization: "Bearer t" },
            },
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
        const manager = await loadMcpTools({
            srv: { type: "stdio", command: "node" },
        });
        const handler = manager.tools[0].handler;
        const client = mocks.state.clients[0];

        // 默认 impl：旗标（callToolFailMsg）非 null 时失败，否则 ok——便于覆盖重连场景
        const applyDefault = (c: { callTool: ReturnType<typeof vi.fn> }) =>
            c.callTool.mockImplementation(() =>
                mocks.state.callToolFailMsg !== null
                    ? Promise.reject(new Error(mocks.state.callToolFailMsg))
                    : Promise.resolve({ content: [{ type: "text", text: "ok" }] })
            );
        applyDefault(client);
        await expect(handler({ x: 1 })).resolves.toBe("ok");
        expect(client.callTool).toHaveBeenCalledWith({
            name: "foo",
            arguments: { x: 1 },
        });

        client.callTool.mockImplementation(async () => ({
            content: [{ type: "text", text: "bad" }],
            isError: true,
        }));
        await expect(handler({})).resolves.toBe("[Error] bad");

        // FR-17 自动重连：callTool 失败 → 失活 → 新 client 重连重试一次；
        // 持续失败（旗标对新 client 同样生效）→ [Error]（限定名 mcp__srv__foo）
        mocks.state.callToolFailMsg = "boom";
        client.callTool.mockImplementation(applyDefault(client) as never);
        await expect(handler({})).resolves.toBe(
            "[Error] MCP tool mcp__srv__foo failed: boom"
        );
        expect(mocks.state.clients.length).toBe(2); // 重连产生了新 client
        mocks.state.callToolFailMsg = null;
    });

    it("AC-004 cleanup = release（引用计数）；空闲回收后关闭（AR-18 池化）", async () => {
        const manager = await loadMcpTools({
            a: { type: "stdio", command: "node" },
            b: { type: "stdio", command: "node" },
        });
        // cleanup = release：不立即 close（连接跨 run 复用）
        await manager.cleanup();
        expect(mocks.state.clients[0].close).not.toHaveBeenCalled();
        expect(mocks.state.clients[1].close).not.toHaveBeenCalled();
        // 空闲回收（maxIdle=0）：refCount 0 的连接被关闭
        closeIdleConnections(0);
        await new Promise((r) => setTimeout(r, 0));
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
        const manager = await loadMcpTools({
            srv: { type: "stdio", command: "node" },
        });

        const ctx = mkCtx();
        const result = await toolCall(
            [
                {
                    id: "tc1",
                    type: "function",
                    function: { name: "mcp__srv__foo", arguments: "{}" },
                },
            ],
            ctx,
            manager.tools,
            "t1"
        );
        expect(result[0]).toMatchObject({
            role: "tool",
            content: "ok",
            tool_call_id: "tc1",
        });
        // SPEC-018：TOOL_START + TOOL 两次 submit
        expect(ctx.eventStream.submit).toHaveBeenCalledTimes(2);
        const calls = (ctx.eventStream.submit as ReturnType<typeof vi.fn>).mock
            .calls;
        expect(calls[0][0]).toMatchObject({
            type: "ToolStart",
            message: "mcp__srv__foo",
            turnId: "t1",
        });
        expect(calls[1][0]).toMatchObject({
            type: "Tool",
            message: "mcp__srv__foo",
            data: { name: "mcp__srv__foo", args: {}, result: "ok" },
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
        expect(manager.tools[0].schema.function.name).toBe("mcp__b__bar");
        await manager.cleanup();
        // 池化：失败的 a 未入池；成功的 b release 后由空闲回收关闭
        expect(mocks.state.clients[0].close).not.toHaveBeenCalled();
        expect(mocks.state.clients[1].close).not.toHaveBeenCalled();
        closeIdleConnections(0);
        await new Promise((r) => setTimeout(r, 0));
        expect(mocks.state.clients[1].close).toHaveBeenCalledOnce();
    });

    it("enabled:false 的 server 不建连（保留定义、Settings 可开关）", async () => {
        mocks.state.listToolsResult = {
            tools: [{ name: "on-tool", description: "", inputSchema: {} }],
        };
        const manager = await loadMcpTools({
            off: { type: "stdio", command: "node", enabled: false },
            on: { type: "stdio", command: "node" },
        });
        expect(manager.tools).toHaveLength(1);
        expect(manager.tools[0].schema.function.name).toBe("mcp__on__on-tool");
        await manager.cleanup();
    });
});


// ── AR-18 连接池：跨 run 复用 ──

describe("MCP 连接池（AR-18）", () => {
    beforeEach(async () => {
        resetState();
        vi.clearAllMocks();
        await resetPool();
    });

    it("同配置跨 run 复用连接：client 不重建、不重复 connect", async () => {
        const servers = { srv: { type: "stdio", command: "node" } };
        const m1 = await loadMcpTools(servers);
        await m1.cleanup(); // release（refCount 0，空闲回收前仍存活）
        const m2 = await loadMcpTools(servers);
        await m2.cleanup();
        expect(mocks.state.clients).toHaveLength(1); // 复用，未重建
        expect(mocks.state.clients[0].connect).toHaveBeenCalledOnce();
    });

    it("同名校验：配置不同 → 不同池键 → 各自建连", async () => {
        const m1 = await loadMcpTools({ srv: { type: "stdio", command: "node" } });
        const m2 = await loadMcpTools({ srv: { type: "stdio", command: "node2" } });
        expect(mocks.state.clients).toHaveLength(2);
        await m1.cleanup();
        await m2.cleanup();
    });

    it("失活重建：healthy=false 的池条目 → 下次 acquire 重建", async () => {
        mocks.state.listToolsResult = {
            tools: [{ name: "foo", description: "", inputSchema: {} }],
        };
        const servers = { srv: { type: "stdio", command: "node" } };
        const m1 = await loadMcpTools(servers);
        mocks.state.callToolFailMsg = "boom";
        // 触发失活：callTool 两次失败 → 连接 unhealthy
        await m1.tools[0].handler({}).catch(() => {});
        mocks.state.callToolFailMsg = null;
        // handler 内部已重连并恢复 healthy（healthy=true）——改用直接置失活验证重建路径：
        // 这里改为通过 closeIdle 前的第二次 acquire：healthy 恢复 → 复用
        const m2 = await loadMcpTools(servers);
        // 失活重建：m1 的 client[0]（重连产生 client[1] 仍失败被弃）→ m2 得 client[2]
        expect(mocks.state.clients.length).toBe(3);
        await m1.cleanup();
        await m2.cleanup();
    });
});
