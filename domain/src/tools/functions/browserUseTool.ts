import type { ToolContext } from "../../context";
import { errResult, toolConfig } from "./webHttp";
import type { Tool } from "../index";

/**
 * browser_use —— 真实浏览器（CDP）原生工具（用户决策 2026-09-03 取代内置 MCP 连接器；
 * 2026-09-04 三合一为单工具，action 分派）：
 * navigate（导航+等加载）/ content（URL/标题/正文）/ eval（任意 JS）。
 * 接 browser 级 http 端点（chrome/edge `--remote-debugging-port=9222`），GET /json/list
 * 自动发现 page ws——无需手取动态 page id。cdpUrl 来自 tools.browser_use.config。
 * 全局 WebSocket（Node ≥21）；连接与页面级客户端为本模块单例，跨调用复用。
 */

const NAV_TIMEOUT_MS = 15_000;
const TEXT_LIMIT = 20_000;

// ———— 最小 WebSocket 形状（不依赖 DOM lib；Node ≥21 全局可用） ————
interface WsLike {
    readyState: number;
    send(data: string): void;
    close(): void;
    onopen: (() => void) | null;
    onmessage: ((ev: { data: unknown }) => void) | null;
    onerror: (() => void) | null;
    onclose: (() => void) | null;
}
const WS = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket;

function cdpUrlOf(ctx: ToolContext): string {
    const cfg = toolConfig(ctx, "browser_use");
    return typeof cfg.cdpUrl === "string" ? cfg.cdpUrl : "";
}

// ———— CDP 端点解析：GET /json/list 自动发现 page ws ————
async function resolvePageWs(raw: string): Promise<string> {
    if (!raw)
        throw new Error(
            "未配置 cdpUrl（tools.browser_use.config.cdpUrl）。需先启动浏览器：chrome --remote-debugging-port=9222"
        );
    let origin: URL;
    try {
        origin = new URL(raw);
    } catch {
        throw new Error(`cdpUrl 非法：${raw}（需 http://host:port）`);
    }
    const res = await fetch(`${origin.origin}/json/list`, {
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`CDP /json/list HTTP ${res.status}（${origin.origin}）`);
    const list = (await res.json()) as Array<{
        type?: string;
        webSocketDebuggerUrl?: string;
    }>;
    const page = (list ?? []).find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl
    );
    if (!page?.webSocketDebuggerUrl)
        throw new Error(
            `CDP 端点 ${origin.origin} 无 page target（先在浏览器里打开任意页面）`
        );
    return page.webSocketDebuggerUrl;
}

// ———— CDP 客户端（模块级单例，跨调用复用） ————
let ws: WsLike | null = null;
let nextId = 1;
const pending = new Map<number, {
    resolve: (v: CdpResult) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}>();
let loadWaiters: Array<() => void> = [];

interface CdpResult {
    result?: { value?: unknown };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
}

function cdp(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
    return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== 1) return reject(new Error("CDP 未连接"));
        const id = nextId++;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP ${method} 超时（15s）`));
        }, 15_000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
    });
}

async function connect(cdpUrl: string): Promise<void> {
    if (ws && ws.readyState === 1) return;
    const url = await resolvePageWs(cdpUrl);
    if (!WS) throw new Error("运行时无全局 WebSocket（需 Node ≥21 / Electron ≥17 配置 NodeIntegrationWebSocket）");
    await new Promise<void>((resolve, reject) => {
        ws = new WS(url);
        const timer = setTimeout(() => {
            ws?.close();
            reject(new Error("CDP 连接超时（10s）"));
        }, 10_000);
        ws.onopen = () => {
            clearTimeout(timer);
            ws!.onmessage = (ev) => {
                let msg: {
                    id?: number;
                    error?: { message: string };
                    result?: CdpResult;
                    method?: string;
                };
                try {
                    msg = JSON.parse(String(ev.data));
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
            ws!.onerror = () => {};
            ws!.onclose = () => {
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

async function ensureReady(cdpUrl: string): Promise<void> {
    if (!ws || ws.readyState !== 1) await connect(cdpUrl);
}

async function waitLoad(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), timeoutMs);
        loadWaiters.push(() => {
            clearTimeout(t);
            resolve(true);
        });
    });
}

interface PageInfo {
    url: string;
    title: string;
    text: string;
    truncated?: boolean;
    noMatch?: boolean;
}

async function contentOf(selector?: string): Promise<PageInfo> {
    // selector：只取命中区域文本（RR-028 一期）；截断时带标记，模型知道内容不完整
    const sel = typeof selector === "string" && selector.trim() ? selector.trim().replace(/'/g, "\\'") : "";
    const expr = sel
        ? "(() => { const el = document.querySelector('" + sel + "'); const full = el ? el.innerText : ''; return {url: location.href, title: document.title, text: full.slice(0," + TEXT_LIMIT + "), truncated: full.length > " + TEXT_LIMIT + ", noMatch: !el}; })()"
        : "(() => { const full = document.body ? document.body.innerText : ''; return {url: location.href, title: document.title, text: full.slice(0," + TEXT_LIMIT + "), truncated: full.length > " + TEXT_LIMIT + "}; })()";
    const r = await cdp("Runtime.evaluate", {
        expression: expr,
        returnByValue: true,
    });
    const v = r.result?.value as PageInfo | undefined;
    if (!v) return { url: "", title: "", text: "" };
    if (v.noMatch) return { url: v.url, title: v.title, text: "(selector 未命中任何元素)" };
    return v;
}

// ———— 工具（用户决策 2026-09-04：三合一为单个 browser_use，action 分派） ————

async function navigate(args: { url?: string }, ctx: ToolContext): Promise<string> {
    const url = typeof args?.url === "string" ? args.url.trim() : "";
    if (!url) return "Error: url 不能为空";
    if (!/^https?:\/\//i.test(url)) return "Error: 仅支持 http(s) URL";
    try {
        await ensureReady(cdpUrlOf(ctx));
        await cdp("Page.navigate", { url });
        const loaded = await waitLoad(NAV_TIMEOUT_MS);
        // 超时不报错：SPA 异步渲染不会触发 load 事件——照常返回页面状态（RR-028 #4）
        const info = await contentOf();
        return loaded
            ? `导航到 ${url}（load 完成）\n标题: ${info.title}\nURL: ${info.url}`
            : `导航到 ${url}：网络 load 超时，但页面状态如下（SPA 可能仍在异步渲染，可稍后用 content 重读）\n标题: ${info.title}\nURL: ${info.url}`;
    } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function content(
    args: { selector?: string },
    ctx: ToolContext
): Promise<string> {
    try {
        await ensureReady(cdpUrlOf(ctx));
        const selector = typeof args?.selector === "string" ? args.selector : undefined;
        const { url, title, text, truncated } = await contentOf(selector);
        if (!text && !url) return "(页面无内容——可能未导航或空白页)";
        const tail = truncated ? `\n\n(内容已截断至 ${TEXT_LIMIT} 字符——用 selector 参数只取目标区域，或 eval 精读)` : "";
        return `URL: ${url}\n标题: ${title || "(无标题)"}\n\n${text || "(无可读文本)"}${tail}`;
    } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function evalJs(args: { js?: string }, ctx: ToolContext): Promise<string> {
    const js = typeof args?.js === "string" ? args.js : "";
    if (!js) return "Error: js 不能为空";
    try {
        await ensureReady(cdpUrlOf(ctx));
        // awaitPromise：返回 Promise 时等 resolve 再序列化（否则拿到空壳，RR-028 #2）
        const r = await cdp("Runtime.evaluate", {
            expression: js,
            returnByValue: true,
            awaitPromise: true,
        });
        if (r.exceptionDetails) {
            return `Error: 执行异常 ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? ""}`;
        }
        const v = r.result?.value;
        return typeof v === "string" ? v : JSON.stringify(v ?? null, null, 2);
    } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export const browserUseTool: Tool = {
    schema: {
        type: "function",
        function: {
            name: "browser_use",
            description:
                "Drive the real browser via CDP. Actions: navigate (open a URL and wait for load), content (read current page URL/title/body), eval (run JS in the page for clicking, form filling, reading elements).",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["navigate", "content", "eval"],
                        description:
                            "navigate=打开网页并等待加载；content=读当前页 URL/标题/正文；eval=在页面执行 JavaScript",
                    },
                    url: {
                        type: "string",
                        description: "action=navigate 时必填：目标 URL（http/https）",
                    },
                    js: {
                        type: "string",
                        description: "action=eval 时必填：要执行的 JavaScript 表达式/语句（返回 Promise 会自动 await）",
                    },
                    selector: {
                        type: "string",
                        description: "action=content 时可选：CSS 选择器，只读命中区域的文本（长页面防爆上下文）",
                    },
                },
                required: ["action"],
            },
        },
    },
    handler: async (rawArgs, ctx: ToolContext) => {
        const args = rawArgs as { action?: string; url?: string; js?: string; selector?: string };
        if (args?.action === "navigate") return navigate(args, ctx);
        if (args?.action === "content") return content(args, ctx);
        if (args?.action === "eval") return evalJs(args, ctx);
        return "Error: action 必须是 navigate / content / eval 之一";
    },
    meta: { readOnly: false, concurrencySafe: false },
};
