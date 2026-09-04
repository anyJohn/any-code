import type { ToolContext } from "../../context";
import { fetchWithTimeout, htmlToMarkdown, errResult, toolConfig } from "./webHttp";
import type { Tool } from "../index";

/**
 * web_fetch —— 抓取网页转 Markdown（原生工具，用户决策 2026-09-03 取代内置 MCP 连接器）。
 * 出网代理由全局 dispatcher 统一承担（netProxy.applyProxyConfig），本工具不感知。
 * 只 https（明文 http 与本地协议拒绝）；15s 超时；正文默认上限 50KB。
 */

const TEXT_LIMIT = 50_000;
const TIMEOUT_MS = 15_000;

export const webFetchTool: Tool = {
    schema: {
        type: "function",
        function: {
            name: "web_fetch",
            description:
                "Fetch a web page and convert it to markdown text. https only; 15s timeout; body capped at 50KB by default (maxChars may lower it).",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "https:// URL" },
                    maxChars: {
                        type: "number",
                        description: "Optional: max returned chars (<=50000)",
                    },
                },
                required: ["url"],
            },
        },
    },
    handler: async (rawArgs, ctx: ToolContext) => {
        const args = rawArgs as { url?: string; maxChars?: number };
        const url = typeof args?.url === "string" ? args.url.trim() : "";
        if (!url) return errResult("url 不能为空");
        let u: URL;
        try {
            u = new URL(url);
        } catch {
            return errResult("URL 非法");
        }
        if (u.protocol !== "https:") {
            return errResult("仅支持 https://（明文 http 与本地协议已拒绝）");
        }
        const cfg = toolConfig(ctx, "web_fetch");
        const timeoutMs =
            typeof cfg.timeoutMs === "number" && cfg.timeoutMs > 0
                ? Math.min(cfg.timeoutMs, 60_000)
                : TIMEOUT_MS;
        try {
            const { status, text: raw } = await fetchWithTimeout(u.href, {}, timeoutMs);
            if (status !== 200) return errResult(`HTTP ${status}`);
            if (raw.length > TEXT_LIMIT * 4) {
                return errResult("页面过大，拒绝读取");
            }
            const md = htmlToMarkdown(raw);
            const max = Math.min(
                typeof args?.maxChars === "number" ? args.maxChars : TEXT_LIMIT,
                TEXT_LIMIT
            );
            const out = md.length > max ? md.slice(0, max) + "\n…(截断)" : md;
            return {
                content: out || "(页面无可读文本)",
                data: { url: u.href, status, chars: out.length },
            };
        } catch (e) {
            return errResult(
                e instanceof Error && e.name === "TimeoutError"
                    ? `请求超时（${timeoutMs / 1000}s）`
                    : String(e instanceof Error ? e.message : e)
            );
        }
    },
    meta: { readOnly: true, concurrencySafe: true },
};
