import { describe, it, expect } from "vitest";
import { agentLoop } from "../src/core";
import type { ChatMessage } from "../src/type";
import type { ToolContext } from "../src/context";
import type { LlmProvider } from "../src/config";

/**
 * SPEC-043 DEC-159 端到端：真 callLLM + 真 HTTP（/tmp/mock-provider.mjs 在 18099），
 * 不 mock openai——验证 SDK 真 APIError 的 status 能被 isImageUnsupportedError 命中，
 * 且 agentLoop 去图后同轮重试成功。缺 mock provider 时跳过（本地/CI 无该进程）。
 */
const BASE = "http://127.0.0.1:18099/v1";

async function providerUp(): Promise<boolean> {
    try {
        const res = await fetch(`${BASE}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "ping" }], stream: false }),
        });
        return res.ok;
    } catch {
        return false;
    }
}

const up = await providerUp();

describe.skipIf(!up)("图片降级端到端（SPEC-043 DEC-159，真 SDK + 真 HTTP）", () => {
    const llm: LlmProvider = {
        apiKey: "k",
        baseURL: BASE,
        models: [{ id: "m" }],
        defaultModel: "m",
        streaming: false,
        contextWindow: 128000,
        retry: { maxRetries: 0 }, // 关重试：只看降级路径，不等退避
    };

    it("provider 400 拒绝图片 → 去图重试成功，且请求确实先带图后无图", async () => {
        const seen: boolean[] = [];
        const origFetch = globalThis.fetch;
        // 包一层 fetch 记录每次请求是否含 image_url（不改行为）
        globalThis.fetch = (async (input: never, init: never) => {
            const body = (init as { body?: string })?.body ?? "";
            if (String(input).includes("/chat/completions")) {
                seen.push(String(body).includes("image_url"));
            }
            return origFetch(input, init);
        }) as never;

        const events: Array<{ type: string; message: string }> = [];
        const ctx = {
            workspace: {} as never,
            eventStream: { submit: (e: never) => events.push(e) },
            signal: new AbortController().signal,
            llm,
        } as unknown as ToolContext;

        try {
            const messages: ChatMessage[] = [];
            const res = await agentLoop(
                "看图",
                messages,
                5,
                undefined,
                undefined,
                ctx,
                [],
                undefined,
                {
                    content: "看图",
                    images: [{ mimeType: "image/png", base64: "aGk=" }],
                }
            );
            expect(res.stopReason).toBe("completed");
            expect(res.result).toContain("非流式回复"); // 去图后重试拿到了真实回复
            // 重发时该消息已无 image_url，只剩文本占位
            const content = messages[0].content as string;
            expect(typeof content).toBe("string");
            expect(content).not.toContain("image_url");
            expect(content).toContain("rejected image input");
            // 第一次请求带图（被拒），第二次不带图（成功）
            expect(seen[0]).toBe(true);
            expect(seen[seen.length - 1]).toBe(false);
            // 用户可见 Warning
            expect(
                events.some(
                    (e) => e.type === "Warning" && e.message.includes("不支持图片输入")
                )
            ).toBe(true);
        } finally {
            globalThis.fetch = origFetch;
        }
    });
});
