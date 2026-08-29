// 内置连接器：web-search（SPEC-031 B-009 / AC-010）。
// 无依赖 MCP-lite stdio server。provider 可插拔：ddg（无 key 默认，best-effort）/ tavily / bing（配 apiKey）。
// 能力私有配置经 ABILITY_CONFIG（JSON）env 注入，由 main.ts initMcp 写入。

const SERVER = "web-search";
const VERSION = "1.0.0";
const TIMEOUT_MS = 15_000;

let cfg = {};
try {
  cfg = process.env.ABILITY_CONFIG ? JSON.parse(process.env.ABILITY_CONFIG) : {};
} catch {
  cfg = {};
}
const provider = typeof cfg.provider === "string" ? cfg.provider : "ddg";
const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey : "";

const TOOLS = [
  {
    name: "search",
    description:
      "网页搜索，返回标题/URL/摘要列表。query 建议带关键词组合或 site:；maxResults 缺省 8。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: {
          type: "number",
          description: "可选：结果数（1-20）",
        },
      },
      required: ["query"],
    },
  },
];

async function searchDdg(query, max) {
  // 无 key 尽力模式：DuckDuckGo html 端点（可能被限流/反爬——best-effort）
  const u = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(u, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const items = [];
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

async function searchTavily(query, max) {
  if (!apiKey) throw new Error("tavily provider 需要 abilities.web-search.config.apiKey");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: max }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const j = await res.json();
  return (j.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

async function searchBing(query, max) {
  if (!apiKey) throw new Error("bing provider 需要 abilities.web-search.config.apiKey");
  const res = await fetch(
    `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${max}`,
    { headers: { "Ocp-Apim-Subscription-Key": apiKey } }
  );
  if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);
  const j = await res.json();
  return (j.webPages?.value ?? []).map((w) => ({
    title: w.name ?? "",
    url: w.url ?? "",
    snippet: w.snippet ?? "",
  }));
}

async function search(args) {
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  if (!query) return textResult("Error: query 不能为空", true);
  const max = Math.min(
    Math.max(typeof args.maxResults === "number" ? args.maxResults : 8, 1),
    20
  );
  try {
    const items =
      provider === "tavily"
        ? await searchTavily(query, max)
        : provider === "bing"
          ? await searchBing(query, max)
          : await searchDdg(query, max);
    if (!items.length) return textResult("(无搜索结果)");
    const out = items
      .map(
        (r, i) =>
          `${i + 1}. [${r.title || "(无标题)"}](${r.url})${r.snippet ? "\n   " + r.snippet : ""}`
      )
      .join("\n");
    return textResult(`${out}\n\n[provider: ${provider}]`);
  } catch (e) {
    return textResult(
      "Error: " + (e?.name === "AbortError" ? "请求超时（15s）" : String(e?.message ?? e)),
      true
    );
  }
}

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

// ———— MCP stdio 帧层：NDJSON（2025-11-25，每行一 JSON）+ 旧 Content-Length 头帧兼容 ————
let buf = "";
let pendingLen = null;
function writeMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function handle(msg) {
  if (msg.id === undefined) return;
  if (msg.method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER, version: VERSION },
      },
    });
  } else if (msg.method === "ping") {
    writeMessage({ jsonrpc: "2.0", id: msg.id, result: {} });
  } else if (msg.method === "tools/list") {
    writeMessage({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  } else if (msg.method === "tools/call") {
    const name = msg.params?.name;
    if (name !== "search") {
      writeMessage({
        jsonrpc: "2.0",
        id: msg.id,
        result: textResult(`Error: 未知工具 ${name}`, true),
      });
      return;
    }
    search(msg.params?.arguments ?? {}).then((result) =>
      writeMessage({ jsonrpc: "2.0", id: msg.id, result })
    );
  } else {
    writeMessage({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
}
function feed(chunk) {
  buf += chunk.toString("utf8");
  while (true) {
    if (pendingLen !== null) {
      if (buf.length < pendingLen) break;
      const body = buf.slice(0, pendingLen);
      buf = buf.slice(pendingLen);
      pendingLen = null;
      try {
        handle(JSON.parse(body));
      } catch {}
      continue;
    }
    const nl = buf.indexOf("\n");
    if (nl < 0) break;
    let line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const m = /^Content-Length:\s*(\d+)$/i.exec(line.trim());
    if (m) {
      pendingLen = Number(m[1]);
      continue;
    }
    if (!line.trim()) continue;
    try {
      handle(JSON.parse(line));
    } catch {}
  }
}
process.stdin.on("data", feed);
