import { describe, it, expect } from "vitest";
import { webFetchTool } from "../src/tools/functions/webFetchTool";
import { webSearchTool } from "../src/tools/functions/webSearchTool";
import { filterEnabledTools, ToolKit, toolCatalog } from "../src/tools";
import type { ToolContext } from "../src/context";
import type { ToolConfigEntry } from "../src/config";

// 用户决策 2026-09-03：内置 MCP 连接器废除，web_fetch / web_search 改原生工具。
// 真连测试（网络允许时）；代理由全局 dispatcher 承担，本层不感知。

const ctx = (toolsConfig?: Record<string, Record<string, unknown>>): ToolContext =>
    ({ workspace: {} as never, eventStream: { submit: () => {} }, signal: new AbortController().signal, toolsConfig }) as ToolContext;

describe("web_fetch（原生工具）", () => {
    it("真抓 example.com → markdown 正文（代理/直连皆可达路径）", async () => {
        const r = await webFetchTool.handler({ url: "https://example.com" }, ctx());
        expect(r.content).toContain("Example Domain");
        expect((r as { data?: { status?: number } }).data?.status).toBe(200);
    });

    it("http 明文拒绝；非法 URL 拒绝；空 url 拒绝", async () => {
        const http = await webFetchTool.handler({ url: "http://example.com" }, ctx());
        expect(http.content).toContain("https");
        const bad = await webFetchTool.handler({ url: "not-a-url" }, ctx());
        expect(bad.content).toContain("URL 非法");
        const empty = await webFetchTool.handler({}, ctx());
        expect(empty.content).toContain("url");
    });

    it("meta：只读 + 并发安全（权限直通、可并行）", () => {
        expect(webFetchTool.meta).toEqual({ readOnly: true, concurrencySafe: true });
    });
});

describe("web_search（原生工具）", () => {
    it("ddg 尽力模式：网络允许返回结果列表，被墙/限流则错误文案不崩", async () => {
        const r = await webSearchTool.handler({ query: "anycode github" }, ctx());
        expect(typeof r.content).toBe("string");
        expect(r.content.length).toBeGreaterThan(0);
    });

    it("provider 来自 ctx.toolsConfig（tavily 无 apiKey → 明确报错文案）", async () => {
        const r = await webSearchTool.handler(
            { query: "x" },
            ctx({ web_search: { provider: "tavily", apiKey: "" } })
        );
        expect(r.content).toContain("tavily");
    });
});

describe("通用工具开关（filterEnabledTools）", () => {
    const tools = ToolKit.allTools;
    const nameOf = (t: (typeof tools)[number]) =>
        (t.schema as { function?: { name?: string } }).function?.name ?? "";

    it("enabled=false → 剔除；未配置 → 保留", () => {
        const cfg: Record<string, ToolConfigEntry> = {
            bash: { enabled: false },
            web_search: { enabled: true },
        };
        const out = filterEnabledTools(tools, cfg);
        const names = out.map(nameOf);
        expect(names).not.toContain("bash");
        expect(names).toContain("web_search");
        expect(names).toContain("read"); // 未配置默认启用
    });

    it("catalog 覆盖 web 原生工具", () => {
        const names = toolCatalog().map((t) => t.name);
        expect(names).toContain("web_fetch");
        expect(names).toContain("web_search");
        expect(names).toContain("browser_use");
        expect(names).toContain("create_skill");
    });
});
