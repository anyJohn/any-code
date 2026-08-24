import { describe, it, expect, vi } from "vitest";

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));

// mock openai：构造函数返回带 models.list 的 client
vi.mock("openai", () => ({
    default: vi.fn(function () {
        return { models: { list: mockList } };
    }),
}));

import { detectContextWindow, detectMaxOutputTokens } from "../src/config";
import type { LlmProvider } from "../src/config";

const P = (model: string, over: Partial<LlmProvider> = {}): LlmProvider => ({
    apiKey: "k",
    models: [{ id: model }],
    defaultModel: model,
    streaming: true,
    ...over,
});

// 各用例唯一 model id 避免跨用例缓存命中；
// 不用 beforeEach(mockReset/mockClear)——vitest 下 mockRejectedValue 经其包装后 reject 会逃逸 try/catch
describe("detectContextWindow（SPEC-019 AC-002）", () => {
    it("/models 返回 context_window → 取值", async () => {
        mockList.mockResolvedValue({ data: [{ id: "d1", context_window: 200000 }] });
        expect(await detectContextWindow(P("d1"))).toBe(200000);
    });
    it("无 context 字段 → undefined", async () => {
        mockList.mockResolvedValue({ data: [{ id: "d2" }] });
        expect(await detectContextWindow(P("d2"))).toBeUndefined();
    });
    it("抛错 → undefined（不阻断）", async () => {
        mockList.mockRejectedValue(new Error("net err"));
        expect(await detectContextWindow(P("d3"))).toBeUndefined();
    });
    it("context_length 字段也兼容", async () => {
        mockList.mockResolvedValue({ data: [{ id: "d4", context_length: 8192 }] });
        expect(await detectContextWindow(P("d4"))).toBe(8192);
    });
    it("缓存命中不重复网络", async () => {
        mockList.mockResolvedValue({ data: [{ id: "d5", context_window: 999 }] });
        const before = mockList.mock.calls.length;
        await detectContextWindow(P("d5"));
        await detectContextWindow(P("d5"));
        expect(mockList.mock.calls.length - before).toBe(1);
    });
    it("apiKey 空 → undefined（不调 list）", async () => {
        mockList.mockResolvedValue({ data: [] });
        const before = mockList.mock.calls.length;
        expect(await detectContextWindow(P("d6", { apiKey: "" }))).toBeUndefined();
        expect(mockList.mock.calls.length).toBe(before);
    });
});

describe("detectMaxOutputTokens（SPEC-023）", () => {
    it("/models 返回 max_output_tokens → 取值", async () => {
        mockList.mockResolvedValue({ data: [{ id: "m1", max_output_tokens: 16384 }] });
        expect(await detectMaxOutputTokens(P("m1"))).toBe(16384);
    });
    it("无字段 → undefined", async () => {
        mockList.mockResolvedValue({ data: [{ id: "m2" }] });
        expect(await detectMaxOutputTokens(P("m2"))).toBeUndefined();
    });
    it("max_completion_tokens 字段兼容", async () => {
        mockList.mockResolvedValue({ data: [{ id: "m3", max_completion_tokens: 8192 }] });
        expect(await detectMaxOutputTokens(P("m3"))).toBe(8192);
    });
    it("与 detectContextWindow 共享缓存（一次 list 取两字段）", async () => {
        mockList.mockResolvedValue({
            data: [{ id: "m4", context_window: 200000, max_output_tokens: 16384 }],
        });
        const before = mockList.mock.calls.length;
        await detectContextWindow(P("m4"));
        await detectMaxOutputTokens(P("m4"));
        expect(mockList.mock.calls.length - before).toBe(1);
    });
});
