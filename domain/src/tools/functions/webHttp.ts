import type { ToolResult } from "../index";

/**
 * web 类原生工具共享助手（web_fetch / web_search，用户决策 2026-09-03）。
 * 代理不在这一层——出网代理由全局 dispatcher 统一承担（netProxy.applyProxyConfig）。
 */

/** 超时感知的 https GET/POST。返回 { status, text, contentType }；超时抛 AbortError。 */
export async function fetchWithTimeout(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
    timeoutMs = 15_000
): Promise<{ status: number; text: string; contentType: string }> {
    const res = await fetch(url, {
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

/** 从 ctx.toolsConfig 读工具私有配置（main.ts 注入；undefined = 未配置）。 */
export function toolConfig(
    ctx: { toolsConfig?: Record<string, Record<string, unknown>> },
    ...names: string[]
): Record<string, unknown> {
    for (const n of names) {
        const c = ctx.toolsConfig?.[n];
        if (c && typeof c === "object") return c;
    }
    return {};
}
