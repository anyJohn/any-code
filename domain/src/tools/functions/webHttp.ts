import type { ToolResult } from "../index";
import { Config } from "../../config";

/**
 * web 类原生工具共享助手（web_fetch / web_search，用户决策 2026-09-03）。
 * 代理不在这一层——出网代理由全局 dispatcher 统一承担（netProxy.applyProxyConfig）。
 */

/** 超时感知的 https GET/POST。返回 { status, text, contentType }；超时抛 AbortError。 */
import { fetch as undiciFetch } from "undici";

export async function fetchWithTimeout(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
    timeoutMs = 15_000
): Promise<{ status: number; text: string; contentType: string }> {
    // 用 npm undici 的 fetch（而非 node 内置）——netProxy 的全局 dispatcher 与测试
    // MockAgent 都注册在 npm undici 上；node 内置 fetch 不读该 dispatcher（实测穿透）
    const res = await undiciFetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return {
        status: res.status,
        text,
        contentType: res.headers.get("content-type") ?? "",
    };
}

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "").trim();

/** HTML → Markdown（够用即可：标题/链接/段落结构，去 script/style）。 */
export function htmlToMarkdown(html: string): string {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
    const body = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|h[1-6]|li|tr|pre)>/gi, "\n")
        .replace(
            /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
            (_, n: string, t: string) => `\n${"#".repeat(Number(n))} ${stripTags(t)}\n`
        )
        .replace(
            /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
            (_, u: string, t: string) => `[${stripTags(t)}](${u})`
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

/** 文本结果归一化（错误置 isError 形状的内容前缀，模型可读自纠）。 */
export function errResult(message: string): ToolResult {
    return { content: `[Error] ${message}` };
}

/**
 * 工具私有配置（方案 A，用户决策 2026-09-04）：**每次调用现读** config.yaml 的
 * tools 段——run 内改配置立即生效；坏配置回退 ctx 注入值（create 时快照）。
 * names 按序取第一个有 config 的条目（browser_use 等单配置名直接传一个）。
 */
export function toolConfig(
    ctx: { toolsConfig?: Record<string, Record<string, unknown>> },
    ...names: string[]
): Record<string, unknown> {
    try {
        const c = Config.load();
        for (const n of names) {
            const e = c.tools?.[n];
            if (
                e?.config &&
                typeof e.config === "object" &&
                !Array.isArray(e.config)
            ) {
                return e.config as Record<string, unknown>;
            }
        }
    } catch {
        // 坏配置：回退 create 时的快照
    }
    for (const n of names) {
        const c = ctx.toolsConfig?.[n];
        if (c && typeof c === "object") return c;
    }
    return {};
}
