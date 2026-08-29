// 内置连接器：browser（SPEC-031 DEC-031-6 v2 真 CDP 浏览器）。
// 零依赖 MCP-lite stdio server + CDP（Chromium DevTools Protocol）WebSocket 客户端。
// 连接任意外部 CDP 源：chrome/edge `--remote-debugging-port=9222` 的 page 级 ws（/devtools/page/<id>），
// 或未来 desktop 内嵌 offscreen window。cdpUrl 经 ABILITY_CONFIG（JSON）env 注入。
// 工具：browser_navigate（导航+等加载）、browser_content（URL/标题/正文）、browser_eval（任意 JS）。

const SERVER = "browser";
const VERSION = "1.0.0";
const NAV_TIMEOUT_MS = 15_000;
const TEXT_LIMIT = 20_000;

let cfg = {};
try {
  cfg = process.env.ABILITY_CONFIG ? JSON.parse(process.env.ABILITY_CONFIG) : {};
} catch {
  cfg = {};
}
let cdpUrl = typeof cfg.cdpUrl === "string" ? cfg.cdpUrl : "";

const TOOLS = [
  {
    name: "browser_navigate",
    description:
      "导航到 URL 并等待页面加载完成，返回标题。之后用 browser_content 读内容。只建议 https。",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "browser_content",
    description:
      "读取当前页面 URL、标题与正文文本（截断 20000 字符）。浏览流程的第一步。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_eval",
    description:
      "在页面执行任意 JS 并返回结果。用于点击（el.click()）、填表、读取特定元素。返回 by-value 结果或异常信息。",
    inputSchema: {
      type: "object",
      properties: {
        js: { type: "string", description: "JavaScript 表达式/语句" },
      },
      required: ["js"],
    },
  },
];

// ———— CDP 客户端（全局 WebSocket，零依赖）————
let ws = null;
let nextId = 1;
const pending = new Map();
let loadWaiters = [];

function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error("CDP 未连接"));
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} 超时（15s）`));
    }, 15_000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    if (!cdpUrl) return reject(new Error("未配置 cdpUrl（abilities.browser.config.cdpUrl）。需先启动浏览器：chrome --remote-debugging-port=9222"));
    if (ws && ws.readyState === 1) return resolve();
    ws = new WebSocket(cdpUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("CDP 连接超时（10s）"));
    }, 10_000);
    ws.onopen = () => {
      clearTimeout(timer);
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.id !== undefined) {
          const p = pending.get(msg.id);
          if (!p) return;
          pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(`CDP: ${msg.error.message}`));
          else p.resolve(msg.result ?? {});
        } else if (msg.method === "Page.loadEventFired") {
          for (const w of loadWaiters.splice(0)) w();
        }
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        ws = null;
        for (const [, p] of pending) clearTimeout(p.timer);
        pending.clear();
      };
      // 开 Page 域以收 loadEventFired
      cdp("Page.enable").catch(() => {});
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("CDP 连接失败（检查 cdpUrl 与浏览器调试端口）"));
      ws = null;
    };
  });
}

async function ensureReady() {
  if (!ws || ws.readyState !== 1) await connect();
}

async function waitLoad(timeoutMs) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    loadWaiters.push(() => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

// ———— 工具实现 ————
async function navigate(args) {
  const url = typeof args?.url === "string" ? args.url.trim() : "";
  if (!url) return textResult("Error: url 不能为空", true);
  if (!/^https?:\/\//i.test(url)) {
    return textResult("Error: 仅支持 http(s) URL", true);
  }
  try {
    await ensureReady();
    await cdp("Page.navigate", { url });
    const loaded = await waitLoad(NAV_TIMEOUT_MS);
    const info = await contentOf();
    return textResult(
      `导航到 ${url}（load ${loaded ? "完成" : "超时(<<继续读可能不完整)"}）\n标题: ${info.title}\nURL: ${info.url}`
    );
  } catch (e) {
    return textResult("Error: " + String(e?.message ?? e), true);
  }
}

async function contentOf() {
  const r = await cdp("Runtime.evaluate", {
    expression:
      "({url: location.href, title: document.title, text: (document.body?document.body.innerText:'').slice(0," +
      TEXT_LIMIT +
      ")})",
    returnByValue: true,
  });
  return r.result?.value ?? { url: "", title: "", text: "" };
}

async function content() {
  try {
    await ensureReady();
    const { url, title, text } = await contentOf();
    if (!text && !url) return textResult("(页面无内容——可能未导航或空白页)");
    return textResult(
      `URL: ${url}\n标题: ${title || "(无标题)"}\n\n${text || "(无可读文本)"}`
    );
  } catch (e) {
    return textResult("Error: " + String(e?.message ?? e), true);
  }
}

async function evalJs(args) {
  const js = typeof args?.js === "string" ? args.js : "";
  if (!js) return textResult("Error: js 不能为空", true);
  try {
    await ensureReady();
    const r = await cdp("Runtime.evaluate", {
      expression: js,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      return textResult(
        `Error: 执行异常 ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? ""}`,
        true
      );
    }
    const v = r.result?.value;
    return textResult(
      typeof v === "string" ? v : JSON.stringify(v ?? null, null, 2)
    );
  } catch (e) {
    return textResult("Error: " + String(e?.message ?? e), true);
  }
}

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

// ———— MCP stdio 帧层：NDJSON + 旧 Content-Length 兼容 ————
let buf = "";
let pendingLen = null;
function writeMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
const TOOL_IMPL = {
  browser_navigate: navigate,
  browser_content: content,
  browser_eval: evalJs,
};
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
    const fn = TOOL_IMPL[name];
    if (!fn) {
      writeMessage({
        jsonrpc: "2.0",
        id: msg.id,
        result: textResult(`Error: 未知工具 ${name}`, true),
      });
      return;
    }
    fn(msg.params?.arguments ?? {}).then((result) =>
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