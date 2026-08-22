import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
import { toolCall } from "../src/tools/toolCall";
import { EventType } from "../src/type";
import type { ToolContext } from "../src/context";
import { createWorkspace } from "../src/workspace";

const writeMcpConfig = (rootPath: string, config: unknown) => {
    const dir = path.join(rootPath, ".anycode");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mcp.json"), JSON.stringify(config));
};

const mkWorkspace = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-mcp-"));
    return { workspace: createWorkspace(dir), dir };
};

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

describe("MCP 真协议连接（mcp.ts / SPEC-006）", () => {
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
        const { workspace, dir } = mkWorkspace();
        writeMcpConfig(dir, {
            srv: { type: "stdio", command: "node", args: ["s.js"], env: { X: "1" } },
        });
        const manager = await loadMcpTools(workspace);

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
        expect(typeof manager.tools[0].handler).toBe("function");
    });

    it("AC-002 SSE server 建连（url + headers）", async () => {
        const { workspace, dir } = mkWorkspace();
        writeMcpConfig(dir, {
            srv: { type: "sse", url: "http://x/sse", headers: { Authorization: "Bearer t" } },
        });
        await loadMcpTools(workspace);

        expect(SSEClientTransport).toHaveBeenCalledOnce();
        const t = mocks.state.sseTransports[0] as { url: URL; opts: unknown };
        expect(t.url.toString()).toBe("http://x/sse");
        expect(t.opts).toMatchObject({
            eventSourceInit: { headers: { Authorization: "Bearer t" } },
            requestInit: { headers: { Authorization: "Bearer t" } },
        });
        expect(mocks.state.clients[0].connect).toHaveBeenCalledOnce();
        expect(mocks.state.clients[0].listTools).toHaveBeenCalledOnce();
    });

    it("AC-003 handler 经 callTool 转发；成功返回 text，失败/异常回传 [Error] 不抛", async () => {
        mocks.state.listToolsResult = {
            tools: [{ name: "foo", description: "", inputSchema: {} }],
        };
        const { workspace, dir } = mkWorkspace();
        writeMcpConfig(dir, { srv: { type: "stdio", command: "node" } });
        const manager = await loadMcpTools(workspace);
        const handler = manager.tools[0].handler;
        const client = mocks.state.clients[0];

        // 成功：返回 text
        client.callTool.mockResolvedValue({
            content: [{ type: "text", text: "result" }],
        });
        await expect(handler({ x: 1 })).resolves.toBe("result");
        expect(client.callTool).toHaveBeenCalledWith({
            name: "foo",
            arguments: { x: 1 },
        });

        // isError：前缀 [Error]
        client.callTool.mockResolvedValue({
            content: [{ type: "text", text: "bad" }],
            isError: true,
        });
        await expect(handler({})).resolves.toBe("[Error] bad");

        // 异常：回传 [Error] 不抛
        client.callTool.mockRejectedValue(new Error("boom"));
        await expect(handler({})).resolves.toBe("[Error] MCP tool foo failed: boom");
    });

    it("AC-004 cleanup 关闭所有已连 client；失败 server 不 close", async () => {
        const { workspace, dir } = mkWorkspace();
        writeMcpConfig(dir, {
            a: { type: "stdio", command: "node" },
            b: { type: "stdio", command: "node" },
        });
        const manager = await loadMcpTools(workspace);
        await manager.cleanup();
        expect(mocks.state.clients[0].close).toHaveBeenCalledOnce();
        expect(mocks.state.clients[1].close).toHaveBeenCalledOnce();
    });

    it("AC-005 新格式按 type 选 transport；无 type 的旧格式跳过记错", async () => {
        const { workspace, dir } = mkWorkspace();
        writeMcpConfig(dir, {
            good: { type: "stdio", command: "node" },
            legacy: { command: "node", schema: {} },
        });
        await loadMcpTools(workspace);

        // 只 good 建连，legacy（无 type）被跳过
        expect(StdioClientTransport).toHaveBeenCalledOnce();
        expect(mocks.state.clients).toHaveLength(1);
    });

    it("AC-006 无 mcp.json / 空配置 → agent 仅内置工具，不报错", async () => {
        const { workspace } = mkWorkspace(); // 不写 mcp.json
        const manager = await loadMcpTools(workspace);
        expect(manager.tools).toHaveLength(0);
        await expect(manager.cleanup()).resolves.toBeUndefined();

        const { workspace: ws2, dir: dir2 } = mkWorkspace();
        writeMcpConfig(dir2, {});
        const m2 = await loadMcpTools(ws2);
        expect(m2.tools).toHaveLength(0);
    });

    it("AC-007 MCP 工具经 toolCall 执行，照常提交 TOOL 事件", async () => {
        mocks.state.listToolsResult = {
            tools: [{ name: "foo", description: "", inputSchema: {} }],
        };
        const { workspace, dir } = mkWorkspace();
        writeMcpConfig(dir, { srv: { type: "stdio", command: "node" } });
        const manager = await loadMcpTools(workspace);

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

    it("AC-008 单 server 连接失败不阻断其余 server + agent 启动", async () => {
        mocks.state.failConnectOn = 0; // 第一个 server 连接失败
        mocks.state.listToolsResult = {
            tools: [{ name: "bar", description: "", inputSchema: {} }],
        };
        const { workspace, dir } = mkWorkspace();
        writeMcpConfig(dir, {
            a: { type: "stdio", command: "node" },
            b: { type: "stdio", command: "node" },
        });
        const manager = await loadMcpTools(workspace);

        // a 连接失败被跳过，b 成功 → 1 个工具（bar）
        expect(manager.tools).toHaveLength(1);
        expect(manager.tools[0].schema.function.name).toBe("bar");
        // cleanup 只关 b（a 连接失败未注册 cleanup）
        await manager.cleanup();
        expect(mocks.state.clients[0].close).not.toHaveBeenCalled();
        expect(mocks.state.clients[1].close).toHaveBeenCalledOnce();
    });
});
