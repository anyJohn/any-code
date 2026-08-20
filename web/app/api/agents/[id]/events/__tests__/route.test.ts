import { describe, it, expect, vi, beforeEach } from "vitest";

// mock agentPool：注入 fake agent，避免实例化真 AnyAgent（依赖 LLM/.env）。
const { getAgent } = vi.hoisted(() => ({ getAgent: vi.fn() }));
vi.mock("@/lib/server/agentPool", () => ({
    getAgent,
    __setAgentForTest: vi.fn(),
}));

import { GET } from "@/app/api/agents/[id]/events/route";

function makeReq(signal?: AbortSignal) {
    return new Request("http://localhost/api/agents/a1/events", {
        signal,
    }) as unknown as Parameters<typeof GET>[0];
}

/** 用单个 reader 持续读 stream，命中 predicate 后仍保留 reader 供后续读。 */
async function openReader(resp: Response) {
    const reader = resp.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    async function readUntil(until: (t: string) => boolean, timeout = 500) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const { value, done } = await reader.read();
            if (value) {
                text += dec.decode(value, { stream: true });
                if (until(text)) return true;
            }
            if (done) return false;
        }
        return false;
    }
    return {
        readUntil,
        getText: () => text,
        cancel: () => reader.cancel(),
    };
}

describe("SSE /api/agents/:id/events (TEST-002 TC-002.1/.2/.3)", () => {
    beforeEach(() => getAgent.mockReset());

    it("TC-002.3 不存在 agent → 404", async () => {
        getAgent.mockReturnValue(null);
        const resp = await GET(makeReq(), {
            params: Promise.resolve({ id: "nope" }),
        });
        expect(resp.status).toBe(404);
    });

    it("TC-002.2 SSE headers 正确", async () => {
        const unsubSpy = vi.fn();
        let liveCb: ((e: unknown) => void) | null = null;
        getAgent.mockReturnValue({
            eventHistory$: { value: [] },
            eventStream$: {
                subscribe: (cb: (e: unknown) => void) => {
                    liveCb = cb;
                    return { unsubscribe: unsubSpy };
                },
            },
        });
        const resp = await GET(makeReq(), {
            params: Promise.resolve({ id: "a1" }),
        });
        expect(resp.headers.get("Content-Type")).toBe("text/event-stream");
        expect(resp.headers.get("X-Accel-Buffering")).toBe("no");
        expect(resp.headers.get("Cache-Control")).toContain("no-cache");
        // 关闭 reader 防泄漏
        resp.body?.cancel();
    });

    it("TC-002.1 回灌历史 + 增量 + 断开取消订阅", async () => {
        const unsubSpy = vi.fn();
        let liveCb: ((e: unknown) => void) | null = null;
        const h1 = { type: "System", message: "history-1" };
        getAgent.mockReturnValue({
            eventHistory$: { value: [h1] },
            eventStream$: {
                subscribe: (cb: (e: unknown) => void) => {
                    liveCb = cb;
                    return { unsubscribe: unsubSpy };
                },
            },
        });

        const ac = new AbortController();
        const resp = await GET(makeReq(ac.signal), {
            params: Promise.resolve({ id: "a1" }),
        });
        const rd = await openReader(resp);

        // 1) 回灌历史
        expect(await rd.readUntil((t) => t.includes("history-1"))).toBe(true);
        expect(rd.getText()).toContain(`data: ${JSON.stringify(h1)}`);

        // 2) 增量
        liveCb!({ type: "Assistant", message: "live-1" });
        expect(await rd.readUntil((t) => t.includes("live-1"))).toBe(true);

        // 3) 断开 → 取消订阅
        ac.abort();
        await new Promise((r) => setTimeout(r, 30));
        expect(unsubSpy).toHaveBeenCalled();
        rd.cancel();
    });
});
