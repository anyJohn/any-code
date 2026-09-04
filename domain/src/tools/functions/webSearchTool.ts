import type { ToolContext } from "../../context";
import { fetchWithTimeout, errResult, toolConfig } from "./webHttp";
import type { Tool } from "../index";

/**
 * web_search —— 网页搜索（原生工具，用户决策 2026-09-03 取代内置 MCP 连接器）。
 * provider 可插拔：ddg（免 key 默认，best-effort）/ tavily / bing（配 apiKey）。
 * 配置经 ctx.toolsConfig.web_search（provider / apiKey），代理走全局 dispatcher。
 */

interface SearchItem {
    title: string;
    url: string;
    snippet: string;
}

async function searchDdg(query: string, max: number): Promise<SearchItem[]> {
    // 无 key 尽力模式：DuckDuckGo html 端点（可能被限流/反爬——best-effort）
    const u = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const { status, text: html } = await fetchWithTimeout(u, {
        headers: { "user-agent": "Mozilla/5.0" },
    });
    if (status !== 200) throw new Error(`DuckDuckGo HTTP ${status}`);
    const items: SearchItem[] = [];
    for (const m of html.matchAll(
        /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    )) {
        const title = m[2].replace(/<[^>]+>/g, "").trim();
        let url = m[1];
        // DDG 跳转链接 uddg= 参数解包
        const uddg = /uddg=([^&]+)/.exec(url);
        if (uddg) url = decodeURIComponent(uddg[1]);
        items.push({ title, url, snippet: "" });
    }
    let i = 0;
    for (const m of html.matchAll(
        /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    )) {
        if (items[i]) items[i].snippet = m[1].replace(/<[^>]+>/g, "").trim();
        i++;
    }
    return items.slice(0, max);
}

async function searchTavily(
    query: string,
    max: number,
    apiKey: string
): Promise<SearchItem[]> {
    if (!apiKey)
        throw new Error("tavily provider 需要 tools.web_search.config.apiKey");
    const { status, text } = await fetchWithTimeout(
        "https://api.tavily.com/search",
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ api_key: apiKey, query, max_results: max }),
        }
    );
    if (status !== 200) throw new Error(`Tavily HTTP ${status}`);
    const j = JSON.parse(text) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (j.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
    }));
}

async function searchBing(
    query: string,
    max: number,
    apiKey: string
): Promise<SearchItem[]> {
    if (!apiKey)
        throw new Error("bing provider 需要 tools.web_search.config.apiKey");
    const { status, text } = await fetchWithTimeout(
        `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${max}`,
        { headers: { "Ocp-Apim-Subscription-Key": apiKey } }
    );
    if (status !== 200) throw new Error(`Bing HTTP ${status}`);
    const j = JSON.parse(text) as {
        webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> };
    };
    return (j.webPages?.value ?? []).map((w) => ({
        title: w.name ?? "",
        url: w.url ?? "",
        snippet: w.snippet ?? "",
    }));
}

export const webSearchTool: Tool = {
    schema: {
        type: "function",
        function: {
            name: "web_search",
            description:
                "Web search returning a list of {title, url, snippet}. Prefer keyword combinations or site: filters; maxResults defaults to 8.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string" },
                    maxResults: {
                        type: "number",
                        description: "Optional: result count (1-20)",
                    },
                },
                required: ["query"],
            },
        },
    },
    handler: async (rawArgs, ctx: ToolContext) => {
        const args = rawArgs as { query?: string; maxResults?: number };
        const query = typeof args?.query === "string" ? args.query.trim() : "";
        if (!query) return errResult("query 不能为空");
        const max = Math.min(
            Math.max(typeof args?.maxResults === "number" ? args.maxResults : 8, 1),
            20
        );
        const cfg = toolConfig(ctx, "web_search");
        const provider = typeof cfg.provider === "string" ? cfg.provider : "ddg";
        const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey : "";
        try {
            const items =
                provider === "tavily"
                    ? await searchTavily(query, max, apiKey)
                    : provider === "bing"
                      ? await searchBing(query, max, apiKey)
                      : await searchDdg(query, max);
            if (!items.length) {
                return {
                    content: "(无结果——换个更具体的关键词重试)",
                    data: { provider, count: 0 },
                };
            }
            const lines = items.map(
                (it, i) =>
                    `${i + 1}. ${it.title}\n   ${it.url}${it.snippet ? `\n   ${it.snippet}` : ""}`
            );
            return {
                content: lines.join("\n\n"),
                data: { provider, count: items.length },
            };
        } catch (e) {
            // best-effort：搜索失败不终止 run——错误文案给模型自纠（换关键词/换 provider）
            return errResult(String(e instanceof Error ? e.message : e));
        }
    },
    meta: { readOnly: true, concurrencySafe: true },
};
