import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webFetchTool } from "../src/tools/functions/webFetchTool";
import { webSearchTool } from "../src/tools/functions/webSearchTool";
import { filterEnabledTools, ToolKit, toolCatalog } from "../src/tools";
import type { ToolContext } from "../src/context";
import type { ToolConfigEntry } from "../src/config";
import { Config } from "../src/config";

// 用户决策 2026-09-03：内置 MCP 连接器废除，web_fetch / web_search 改原生工具。
// FR-28：联网测试一律走 undici MockAgent——与真实网络解耦，CI 稳定不 flaky。

const ctx = (toolsConfig?: Record<string, Record<string, unknown>>): ToolContext => {
    // toolConfig 现读 live config（toolConfigLive，live 优先于 ctx 注入）——把注入配置
    // 写进隔离 HOME 的真实 config.yaml，使 live 与测试意图一致
    if (toolsConfig) {
        Config.save({
            providers: {
                t: { apiKey: "k", models: [{ id: "m" }], defaultModel: "m" },
            },
            default: "t",
            tools: Object.fromEntries(
                Object.entries(toolsConfig).map(([name, cfg]) => [
                    name,
                    { enabled: true, config: cfg },
                ])
            ),
        });
    }
    return { workspace: {} as never, eventStream: { submit: () => {} }, signal: new AbortController().signal, toolsConfig } as ToolContext;
};

const DDG_HTML = `
<html><body>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2FanyJohn%2Fany-code">AnyCode on GitHub</a>
<a class="result__snippet">A <b>local AI coding agent</b> runs on your machine.</a>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Docs</a>
<a class="result__snippet">Second result snippet.</a>
</body></html>`;

let mockAgent: MockAgent;
const origHome = process.env.HOME;
let home = "";

beforeAll(() => {
    // HOME 隔离：toolConfig 每次现读 config.yaml（toolConfigLive 设计）——
    // 不隔离则真实配置覆盖 ctx.toolsConfig，测试不可注入
    home = mkdtempSync(join(tmpdir(), "anycode-webtools-"));
    process.env.HOME = home;
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    mockAgent
        .get("https://example.com")
        .intercept({ path: "/", method: "GET" })
        .reply(200, "<html><body><h1>Example Domain</h1><p>This domain is for use in examples.</p></body></html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
        })
        .persist();
    mockAgent
        .get("https://html.duckduckgo.com")
        .intercept({ path: /\/html\/.*/, method: "GET" })
        .reply(200, DDG_HTML, { headers: { "content-type": "text/html" } })
        .persist();
    mockAgent
        .get("https://api.tavily.com")
        .intercept({ path: "/search", method: "POST" })
        .reply(200, JSON.stringify({ results: [{ title: "T", url: "https://t.dev", content: "C" }] }), {
            headers: { "content-type": "application/json" },
        })
        .persist();
});

afterAll(() => {
    mockAgent.close();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
});

describe("web_fetch（原生工具）", () => {
    it("抓取页面 → markdown 正文 + status（mock）", async () => {
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
    it("ddg：解析结果 + uddg 链接解包（mock）", async () => {
        const r = await webSearchTool.handler({ query: "anycode" }, ctx());
        expect(r.content).toContain("AnyCode on GitHub");
        expect(r.content).toContain("https://github.com/anyJohn/any-code");
        expect(r.content).toContain("local AI coding agent");
    });

    it("tavily 无 apiKey → 明确报错文案（fetch 前短路，无需 mock 命中）", async () => {
        const r = await webSearchTool.handler(
            { query: "x" },
            ctx({ web_search: { provider: "tavily", apiKey: "" } })
        );
        expect(r.content).toContain("tavily");
    });

    it("tavily 有 apiKey → 返回结构化结果（mock）", async () => {
        const r = await webSearchTool.handler(
            { query: "x" },
            ctx({ web_search: { provider: "tavily", apiKey: "k-test" } })
        );
        expect(r.content).toContain("https://t.dev");
        expect(r.content).toContain("C");
    });

    it("未知 provider → 回退 ddg（dispatch 语义：非 tavily/bing 都走 ddg）", async () => {
        const r = await webSearchTool.handler(
            { query: "x" },
            ctx({ web_search: { provider: "nope" } })
        );
        expect(r.content).toContain("AnyCode on GitHub");
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
