// 内置连接器：web-fetch（SPEC-031 B-008 / AC-009）。
// 零依赖 MCP-lite stdio server。帧层兼容 NDJSON（MCP 2025-11-25 协议，每行一 JSON）+ 旧 Content-Length 头帧。
// 只 https、15s 超时、50KB 文本上限、HTML→Markdown、随包自包含离线分发。

const SERVER = "web-fetch";
const VERSION = "1.0.0";
const TOOL_NAME = "web_fetch";
const TEXT_LIMIT = 50_000;
const TIMEOUT_MS = 15_000;

const TOOLS = [
  {
    name: TOOL_NAME,
    description:
      "抓取网页并转成 markdown 文本。只支持 https；15s 超时；正文默认上限 50KB（可被 maxChars 调小）。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "https:// URL" },
        maxChars: {
          type: "number",
          description: "可选：返回正文上限（≤50000）",
        },
      },
      required: ["url"],
    },
  },
];

const stripTags = (s) => s.replace(/<[^>]+>/g, "").trim();

function htmlToMarkdown(html) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|pre)>/gi, "\n")
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, n, t) => "\n" + "#".repeat(Number(n)) + " " + stripTags(t) + "\n"
    )
    .replace(
      /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, u, t) => `[${stripTags(t)}](${u})`
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return (title ? `# ${title}\n\n` : "") + body;
}

async function fetchUrl(args) {
  const url = typeof args?.url === "string" ? args.url.trim() : "";
  if (!url) return textResult("Error: url 不能为空", true);
  let u;
  try {
    u = new URL(url);
  } catch {
    return textResult("Error: URL 非法", true);
  }
  if (u.protocol !== "https:") {
    return textResult("Error: 仅支持 https://（明文 http 与本地协议已拒绝）", true);
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u, { redirect: "follow", signal: ac.signal });
    if (!res.ok) return textResult(`Error: HTTP ${res.status}`, true);
    const raw = await res.text();
    if (raw.length > TEXT_LIMIT * 4) {
      return textResult("Error: 页面过大，拒绝读取", true);
    }
    const md = htmlToMarkdown(raw);
    const max = Math.min(
      typeof args.maxChars === "number" ? args.maxChars : TEXT_LIMIT,
      TEXT_LIMIT
    );
    const out = md.length > max ? md.slice(0, max) + "\n…(截断)" : md;
    return textResult(out || "(页面无可读文本)");
  } catch (e) {
    return textResult(
      "Error: " + (e?.name === "AbortError" ? "请求超时（15s）" : String(e)),
      true
    );
  } finally {
    clearTimeout(t);
  }
}

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

// ———— MCP stdio 帧层：NDJSON（2025-11-25，每行一 JSON）+ 旧 Content-Length 头帧兼容 ————
let buf = "";
let pendingLen = null;
function writeMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n"); // NDJSON
}
function handle(msg) {
  if (msg.id === undefined) return; // notification（initialized 等）
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
    if (name !== TOOL_NAME) {
      writeMessage({
        jsonrpc: "2.0",
        id: msg.id,
        result: textResult(`Error: 未知工具 ${name}`, true),
      });
      return;
    }
    fetchUrl(msg.params?.arguments ?? {}).then((result) =>
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
      } catch {
        // 损坏帧跳过
      }
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
    if (!line.trim()) continue; // 空行（旧帧的头部结束）
    try {
      handle(JSON.parse(line));
    } catch {
      // 损坏帧跳过
    }
  }
}
process.stdin.on("data", feed);