import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "@/components/StatusBar";
import type { AgentEvent } from "@/lib/sseEvents";

// FR-22：会话累计 tokens（全部 Usage 事件求和）+ 费用（config pricing 按模型戳换算，
// 无单价的事件跳过；未配 pricing 不显示费用）。

const usage = (prompt: number, completion: number, model?: string): AgentEvent =>
    ({
        id: `u-${prompt}-${completion}`,
        timestamp: 1,
        type: "Usage",
        message: `${prompt}`,
        data: { prompt_tokens: prompt, completion_tokens: completion, contextWindow: 128000, ...(model ? { model } : {}) },
    }) as never;

function jsonResponse(obj: unknown): Response {
    return new Response(JSON.stringify(obj), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

describe("StatusBar 会话累计与费用（FR-22）", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => vi.unstubAllGlobals());

    it("配了 pricing → 显示累计 + 按模型戳计费（无单价事件跳过）", async () => {
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockImplementation(async (url: string) => {
            if (String(url).includes("/status"))
                return jsonResponse({
                    provider: "p1",
                    model: "gpt-y",
                    modelName: "GPT-Y",
                    contextWindow: 128000,
                    skillCount: 0,
                    skillNames: [],
                    mcpServers: [],
                });
            return jsonResponse({
                pricing: { "gpt-x": { input: 1, output: 2 } },
            });
        });
        render(
            <StatusBar
                projectKey="pk"
                pending={false}
                events={[
                    usage(1_000_000, 100_000, "gpt-x"), // 1*1 + 0.1*2 = $1.2
                    usage(500_000, 50_000, "gpt-y"), // 无单价 → 跳过
                ]}
            />
        );
        const el = await screen.findByTitle("1500000 + 150000 tokens");
        expect(el.textContent).toMatch(/累计/);
        expect(el.textContent).toContain("$1.2000");
    });

    it("未配 pricing → 只显累计 tokens，不显示费用", async () => {
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockImplementation(async (url: string) => {
            if (String(url).includes("/status"))
                return jsonResponse({
                    provider: "p1",
                    model: "m",
                    modelName: "M",
                    contextWindow: 128000,
                    skillCount: 0,
                    skillNames: [],
                    mcpServers: [],
                });
            return jsonResponse({});
        });
        render(
            <StatusBar
                projectKey="pk"
                pending={false}
                events={[usage(800, 100), usage(400, 50)]}
            />
        );
        const el = await screen.findByTitle("1200 + 150 tokens");
        expect(el.textContent).toMatch(/累计/);
        expect(el.textContent).not.toContain("$");
    });
});
