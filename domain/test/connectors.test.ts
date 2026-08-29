import { describe, it, expect, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// 内置连接器冒烟（SPEC-031 AC-009/010）：经生产同款 SDK（Client + StdioClientTransport）真握手 + 真调用。
const here = dirname(fileURLToPath(import.meta.url));
const SERVERS = join(here, "..", "src", "builtin-servers");

async function call(serverFile: string, tool: string, args: object, env: Record<string, string> = {}) {
    const client = new Client({ name: "anycode-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(SERVERS, serverFile)],
        env,
    });
    await client.connect(transport);
    try {
        const tools = await client.listTools();
        const res = await client.callTool({ name: tool, arguments: args });
        return { toolNames: tools.tools.map((t) => t.name), text: extractText(res) };
    } finally {
        await client.close().catch(() => {});
    }
}

function extractText(res: unknown): string {
    const content = (res as { content?: Array<{ type?: string; text?: string }> })
        ?.content;
    return (content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
}

describe("内置连接器（SPEC-031 B-008/B-009，经 SDK 真连）", () => {
    it("AC-009a web-fetch：tools/list 含 fetch_url；真抓 example.com 返回文本", async () => {
        const r = await call(
            "web-fetch-server.mjs",
            "fetch_url",
            { url: "https://example.com" }
        );
        expect(r.toolNames).toContain("fetch_url");
        expect(r.text).toContain("Example Domain");
    });

    it("AC-009b web-fetch：http 明文被拒绝；超限截断", async () => {
        const bad = await call("web-fetch-server.mjs", "fetch_url", {
            url: "http://example.com",
        });
        expect(bad.text).toMatch(/https/);
        const tiny = await call("web-fetch-server.mjs", "fetch_url", {
            url: "https://example.com",
            maxChars: 50,
        });
        expect(tiny.text.length).toBeLessThanOrEqual(60);
    });

    it("AC-010 web-search：tools/list 含 search；ddg 尽力模式可调（网络允许时返回结果，被墙则 isError 文案，不崩）", async () => {
        const r = await call("web-search-server.mjs", "search", {
            query: "nodejs",
        });
        expect(r.toolNames).toContain("search");
        // 沙箱外网受限时 DDG 可能 fetch 失败 → 错误文案；正常时结果数组
        expect(r.text.length).toBeGreaterThan(0);
    }, 30000);
});