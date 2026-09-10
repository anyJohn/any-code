import type { ToolContext } from "../../context";
import { toolConfig } from "./webHttp";
import type { Tool } from "../index";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

/**
 * browser_use —— 真实浏览器原生工具（SPEC-039 / RR-028 中期）：
 * 底座从裸 CDP WebSocket 换成 playwright-core 的 `chromium.connectOverCDP`——
 * 仍是零配置设计（连用户已开的 Chrome/Edge `--remote-debugging-port=9222`，不下载浏览器），
 * 但白拿 Playwright 的等待/选择器/ariaSnapshot 能力；cookie / 多页签是一行 API。
 *
 * action 面：
 * - navigate(url)：goto，load 超时不报错（SPA 可能仍在异步渲染），返回页面状态
 * - content(selector?)：URL/标题/文本（selector 圈定区域），超 20k 截断带标记
 * - eval(js)：page.evaluate（Promise 自动 await 后序列化）
 * - snapshot()：ariaSnapshot({ ref: true })——无障碍树，元素带 ref（复杂样式点不到的解药）
 * - click(ref|selector) / fill(ref|selector, text)：按 ref（aria-ref=）或 CSS 选择器操作，自动等待可操作
 * - cookies(op)：get / set(name,value,url) / clear
 * - tabs(op, index?, url?)：list / new / select / close
 */

const NAV_TIMEOUT_MS = 15_000;
const TEXT_LIMIT = 20_000;
const ACT_TIMEOUT_MS = 8_000;

function cdpUrlOf(ctx: ToolContext): string {
    const cfg = toolConfig(ctx, "browser_use");
    return typeof cfg.cdpUrl === "string" ? cfg.cdpUrl : "";
}

// ———— 连接缓存（按 cdpUrl 记忆；context 取第一个，页面取最近活跃页） ————
let conn: { url: string; browser: Browser } | null = null;

/** CDP 端点探活分类：refused=端口无服务（浏览器没开）；http=有服务但响应异常（配置可能错）；ok=是 CDP 端点 */
async function probeCdp(cdpUrl: string): Promise<"refused" | "http" | "ok"> {
    try {
        const res = await fetch(cdpUrl.replace(/\/+$/, "") + "/json/version", {
            signal: AbortSignal.timeout(3_000),
        });
        if (!res.ok) return "http";
        const body = (await res.json().catch(() => null)) as { webSocketDebuggerUrl?: string } | null;
        return body?.webSocketDebuggerUrl ? "ok" : "http";
    } catch {
        return "refused";
    }
}

async function browserOf(cdpUrl: string): Promise<Browser> {
    if (conn && conn.url === cdpUrl) {
        // 连接可能已被浏览器侧断开：轻量探测
        try {
            conn.browser.contexts()[0]?.pages();
            return conn.browser;
        } catch {
            try {
                await conn.browser.close();
            } catch {
                // 已断开，忽略
            }
            conn = null;
        }
    }
    if (!cdpUrl)
        throw new Error(
            "cdpUrl is not configured (tools.browser_use.config.cdpUrl). Start the browser first: chrome --remote-debugging-port=9222"
        );
    try {
        const browser = await chromium.connectOverCDP(cdpUrl, {
            timeout: 10_000,
        });
        conn = { url: cdpUrl, browser };
        return browser;
    } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        const kind = await probeCdp(cdpUrl);
        if (kind === "refused")
            throw new Error(
                `Browser is not running: no service is listening on ${cdpUrl}. Start it with remote debugging: chrome --remote-debugging-port=9222 (if the port is not 9222, use the actual port and verify cdpUrl in settings)`
            );
        if (kind === "http")
            throw new Error(
                `cdpUrl may be misconfigured: a service is listening on ${cdpUrl} but it is not a browser debugging endpoint (/json/version responded abnormally). Verify cdpUrl in settings points to the browser's --remote-debugging-port`
            );
        throw new Error(
            `CDP connection failed (endpoint reachable, handshake error): ${raw}. Try restarting the browser: chrome --remote-debugging-port=9222`
        );
    }
}

async function contextOf(cdpUrl: string, browser: Browser): Promise<BrowserContext> {
    const ctx = browser.contexts()[0];
    if (ctx) return ctx;
    // 无上下文 = 调试端口活着但没有任何页面目标（窗口全关只剩后台进程 / 刚启动没开页）。
    // 经 CDP HTTP 端点自开一个空白页（新版 Chrome 要求 PUT），Playwright 随即能看到上下文。
    try {
        await fetch(cdpUrl.replace(/\/+$/, "") + "/json/new?about:blank", { method: "PUT" });
    } catch {
        // 开页失败走下方报错
    }
    const retry = browser.contexts()[0];
    if (retry) return retry;
    throw new Error(
        "No usable page on the CDP endpoint: the browser runs in debug mode but has no open window. Keep at least one window open (or restart: chrome --remote-debugging-port=9222 and open any page)"
    );
}

async function activePage(cdpUrl: string, browser: Browser): Promise<Page> {
    const pages = (await contextOf(cdpUrl, browser)).pages();
    // 取最后一个非 about:blank 页；全空白则取最后一页
    const real = pages.filter((p) => !p.url().startsWith("about:"));
    return (real[real.length - 1] ?? pages[pages.length - 1]) as Page;
}

/** ref（ariaSnapshot ai 模式生成，形如 f1e3）→ aria-ref 定位器；否则按 CSS 选择器。 */
function target(page: Page, refOrSelector: string) {
    const v = refOrSelector.trim();
    return /^\w+\d*e?\d+$/.test(v) && /e\d+$/.test(v) && !v.startsWith(".") && !v.startsWith("#")
        ? page.locator(`aria-ref=${v}`)
        : page.locator(v);
}

async function pageInfo(page: Page, selector?: string): Promise<string> {
    const url = page.url();
    const title = await page.title().catch(() => "");
    const text = selector
        ? await page
              .locator(selector)
              .first()
              .innerText({ timeout: ACT_TIMEOUT_MS })
              .catch(() => "(selector matched no elements)")
        : await page.evaluate(() =>
              document.body ? document.body.innerText : ""
          );
    const full = text ?? "";
    const clipped =
        full.length > TEXT_LIMIT
            ? full.slice(0, TEXT_LIMIT) +
              `\n\n(content clipped to ${TEXT_LIMIT} chars — use the selector param to scope, or eval for targeted reading)`
            : full;
    return `URL: ${url}\nTitle: ${title || "(untitled)"}\n\n${clipped || "(no readable text)"}`;
}

// ———— actions ————

async function navigate(args: { url?: string }, cdpUrl: string, browser: Browser): Promise<string> {
    const url = typeof args?.url === "string" ? args.url.trim() : "";
    if (!url) return "Error: url is required";
    if (!/^https?:\/\//i.test(url)) return "Error: only http(s) URLs are supported";
    const page = await activePage(cdpUrl, browser);
    // load 超时不报错：SPA 异步渲染不会触发 load——照常返回页面状态（RR-028 #4）
    let note = "load completed";
    try {
        await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    } catch {
        note = "network load timed out; page state below (SPA may still be rendering — retry with content later)";
    }
    const info = await pageInfo(page);
    return `Navigated to ${url} (${note})\n${info}`;
}

async function content(
    args: { selector?: string },
    cdpUrl: string,
    browser: Browser
): Promise<string> {
    const page = await activePage(cdpUrl, browser);
    const selector = typeof args?.selector === "string" ? args.selector : undefined;
    return pageInfo(page, selector);
}

async function evalJs(args: { js?: string }, cdpUrl: string, browser: Browser): Promise<string> {
    const js = typeof args?.js === "string" ? args.js : "";
    if (!js) return "Error: js is required";
    const page = await activePage(cdpUrl, browser);
    // page.evaluate 对返回 Promise 自动 await（RR-028 #2）
    try {
        const v = await page.evaluate(js);
        return typeof v === "string" ? v : JSON.stringify(v ?? null, null, 2);
    } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function snapshot(_args: unknown, cdpUrl: string, browser: Browser): Promise<string> {
    const page = await activePage(cdpUrl, browser);
    // 无障碍树 + ref：模型"看快照 → 引用 ref 点击"，复杂样式/iframe/shadow DOM 都能覆盖
    // ai 模式：输出带 [ref=f1e3] 引用
    const snap = await page
        .locator("body")
        .ariaSnapshot({ mode: "ai" })
        .catch(() => "");
    if (!snap) return "(snapshot is empty — the page may not be loaded or has no accessible content)";
    return `Accessibility snapshot (refs look like s1e3; use them with click/fill):\n\n${snap}`;
}

async function click(
    args: { ref?: string; selector?: string },
    cdpUrl: string,
    browser: Browser
): Promise<string> {
    const t = args?.ref || args?.selector;
    if (!t) return "Error: ref (from snapshot) or selector is required";
    const page = await activePage(cdpUrl, browser);
    try {
        await target(page, t).click({ timeout: ACT_TIMEOUT_MS });
        return `Clicked ${t}`;
    } catch (e) {
        return `Error: click ${t} failed: ${e instanceof Error ? e.message : String(e)} (run snapshot first for a fresh ref)`;
    }
}

async function fill(
    args: { ref?: string; selector?: string; text?: string },
    cdpUrl: string,
    browser: Browser
): Promise<string> {
    const t = args?.ref || args?.selector;
    const text = typeof args?.text === "string" ? args.text : undefined;
    if (!t || text === undefined) return "Error: ref/selector and text are required";
    const page = await activePage(cdpUrl, browser);
    try {
        await target(page, t).fill(text, { timeout: ACT_TIMEOUT_MS });
        return `Filled ${t}`;
    } catch (e) {
        return `Error: fill ${t} failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function cookies(
    args: { op?: string; name?: string; value?: string; url?: string },
    cdpUrl: string,
    browser: Browser
): Promise<string> {
    const ctx = await contextOf(cdpUrl, browser);
    const op = args?.op ?? "get";
    if (op === "get") {
        // cookies() 参数是 URL 数组而非名字——按名字过滤在前端做
        const all = await ctx.cookies();
        const list = args?.name ? all.filter((c) => c.name === args.name) : all;
        return JSON.stringify(list, null, 2);
    }
    if (op === "set") {
        if (!args?.name || args?.value === undefined || !args?.url)
            return "Error: set requires name / value / url";
        await ctx.addCookies([
            { name: args.name, value: args.value, url: args.url },
        ]);
        return `Cookie ${args.name} set`;
    }
    if (op === "clear") {
        await ctx.clearCookies();
        return "All cookies cleared";
    }
    return "Error: cookies op must be get / set / clear";
}

async function tabs(
    args: { op?: string; index?: number; url?: string },
    cdpUrl: string,
    browser: Browser
): Promise<string> {
    const ctx = await contextOf(cdpUrl, browser);
    const op = args?.op ?? "list";
    const pages = ctx.pages();
    if (op === "list") return pages.map((p, i) => `${i}: ${p.url()}`).join("\n");
    if (op === "new") {
        const page = await ctx.newPage();
        const url = typeof args?.url === "string" ? args.url.trim() : "";
        if (url)
            await page
                .goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT_MS })
                .catch(() => {});
        return `New tab #${pages.length}${url ? ` navigated to ${url}` : ""}`;
    }
    if (op === "select") {
        const page = pages[args?.index ?? -1];
        if (!page) return "Error: index out of range (see tabs op=list)";
        await page.bringToFront();
        return `Switched to tab ${args?.index}: ${page.url()}`;
    }
    if (op === "close") {
        const page = pages[args?.index ?? -1];
        if (!page) return "Error: index out of range";
        await page.close();
        return `Closed tab ${args?.index}`;
    }
    return "Error: tabs op must be list / new / select / close";
}

export const browserUseTool: Tool = {
    schema: {
        type: "function",
        function: {
            name: "browser_use",
            description:
                "Drive the real browser via CDP (Playwright core, connects to your already-running browser). Actions: navigate, content (optionally scoped by CSS selector), eval (JS, promises auto-awaited), snapshot (accessibility tree with refs — the reliable way to target elements), click / fill (by snapshot ref or CSS selector), cookies (get/set/clear), tabs (list/new/select/close).",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: [
                            "navigate",
                            "content",
                            "eval",
                            "snapshot",
                            "click",
                            "fill",
                            "cookies",
                            "tabs",
                        ],
                        description:
                            "navigate=打开网页；content=读页面（可 selector 圈区域）；eval=执行 JS；snapshot=无障碍树（推荐先做，拿 ref）；click/fill=按 ref 或选择器操作；cookies=读写 cookie；tabs=页签管理",
                    },
                    url: {
                        type: "string",
                        description: "action=navigate / tabs(new)：目标 URL（http/https）",
                    },
                    js: {
                        type: "string",
                        description: "action=eval 时必填：要执行的 JavaScript 表达式/语句（返回 Promise 自动 await）",
                    },
                    selector: {
                        type: "string",
                        description: "action=content/click/fill：CSS 选择器（content 圈区域；click/fill 也可用选择器代替 ref）",
                    },
                    ref: {
                        type: "string",
                        description: "action=click/fill：来自 snapshot 的元素 ref（如 s1e3）",
                    },
                    text: {
                        type: "string",
                        description: "action=fill 时必填：要填入的文本",
                    },
                    op: {
                        type: "string",
                        description: "action=cookies：get/set/clear；action=tabs：list/new/select/close",
                    },
                    name: {
                        type: "string",
                        description: "action=cookies(set/get)：cookie 名",
                    },
                    value: {
                        type: "string",
                        description: "action=cookies(set)：cookie 值",
                    },
                    index: {
                        type: "number",
                        description: "action=tabs(select/close)：页签下标（tabs list 查看）",
                    },
                },
                required: ["action"],
            },
        },
    },
    handler: async (rawArgs, ctx: ToolContext) => {
        const args = rawArgs as {
            action?: string;
            url?: string;
            js?: string;
            selector?: string;
            ref?: string;
            text?: string;
            op?: string;
            name?: string;
            value?: string;
            index?: number;
        };
        const ACTIONS = ["navigate", "content", "eval", "snapshot", "click", "fill", "cookies", "tabs"];
        if (!ACTIONS.includes(args?.action ?? ""))
            return "Error: action must be one of navigate / content / eval / snapshot / click / fill / cookies / tabs";
        let browser: Browser;
        const cdpUrl = cdpUrlOf(ctx);
        try {
            browser = await browserOf(cdpUrl);
        } catch (e) {
            return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
        switch (args?.action) {
            case "navigate":
                return navigate(args, cdpUrl, browser);
            case "content":
                return content(args, cdpUrl, browser);
            case "eval":
                return evalJs(args, cdpUrl, browser);
            case "snapshot":
                return snapshot(args, cdpUrl, browser);
            case "click":
                return click(args, cdpUrl, browser);
            case "fill":
                return fill(args, cdpUrl, browser);
            case "cookies":
                return cookies(args, cdpUrl, browser);
            case "tabs":
                return tabs(args, cdpUrl, browser);
            default:
                return "Error: 未知 action"; // 不可达（上方已校验），仅为收窄类型
        }
    },
    meta: { readOnly: false, concurrencySafe: false },
};
