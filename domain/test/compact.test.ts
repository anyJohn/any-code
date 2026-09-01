import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => ({
    default: vi.fn(function () {
        return { chat: { completions: { create: mockCreate } } };
    }),
}));

import {
    compactMessages,
    splitForCompact,
    estimateTokens,
} from "../src/compact";
import { COMPACT_HANDOFF_PREFIX } from "../src/prompt";
import type { ChatMessage } from "../src/type";
import type { LlmProvider } from "../src/config";

const PROVIDER: LlmProvider = {
    apiKey: "k",
    models: [{ id: "m" }],
    defaultModel: "m",
    streaming: false,
    contextWindow: 128000,
};

const u = (c: string): ChatMessage => ({ role: "user", content: c }) as never;
const a = (c: string): ChatMessage => ({ role: "assistant", content: c }) as never;
const aTc = (c: string, id: string): ChatMessage =>
    ({
        role: "assistant",
        content: c,
        tool_calls: [
            { id, type: "function", function: { name: "foo", arguments: "{}" } },
        ],
    }) as never;
const tool = (c: string, id: string): ChatMessage =>
    ({ role: "tool", content: c, tool_call_id: id }) as never;
const sys = (c: string): ChatMessage => ({ role: "system", content: c }) as never;

describe("compact.ts", () => {
    beforeEach(() => mockCreate.mockReset());

    describe("estimateTokens（AC-002）", () => {
        it("有 lastUsage 用 prompt_tokens", () => {
            expect(estimateTokens([u("x")], { prompt_tokens: 4242 })).toBe(4242);
        });
        it("无 lastUsage 用 chars/4 兜底", () => {
            // [user,"hello"] JSON 长度 > 0，tokens = ceil(len/4)
            const msgs = [u("hello")];
            const len = JSON.stringify(msgs).length;
            expect(estimateTokens(msgs)).toBe(Math.ceil(len / 4));
        });
    });

    describe("splitForCompact（AC-001 配对感知）", () => {
        it("tail[0] 为 tool → 回拉父 assistant(tool_calls) 进 tail", () => {
            // a2(tc2) 的结果 t2 落在 tail[0]
            const rest = [u("u1"), aTc("a1", "tc1"), tool("t1", "tc1"), u("u2"), aTc("a2", "tc2"), tool("t2", "tc2"), u("u3"), a("a3")];
            const { head, tail } = splitForCompact(rest, 3);
            // cut 本应 5（rest[5]=t2），tool 起始→回拉到 4（rest[4]=a2）
            expect(tail[0]).toBe(rest[4]); // a2
            expect((tail[0] as Record<string, unknown>).role).toBe("assistant");
            // tail 内 t2 的父 a2 同在 tail → 配对完整
            expect(tail).toHaveLength(4);
            expect(head).toEqual(rest.slice(0, 4));
            // head 内 t1 的父 a1 同在 head
            expect(head.some((m) => (m as Record<string, unknown>).role === "tool")).toBe(true);
        });

        it("tail[0] 非 tool → 不回拉", () => {
            const rest = [u("u1"), a("a1"), u("u2"), a("a2"), u("u3"), a("a3")];
            const { head, tail } = splitForCompact(rest, 3);
            expect(tail).toEqual(rest.slice(3));
            expect(head).toEqual(rest.slice(0, 3));
        });

        it("keepN > rest.length → tail=rest 全量、head 空", () => {
            const rest = [u("u1"), a("a1")];
            const { head, tail } = splitForCompact(rest, 6);
            expect(head).toEqual([]);
            expect(tail).toEqual(rest);
        });
    });

    describe("compactMessages（AC-001）", () => {
        it("tail[0] 非 user → 摘要作独立 user 消息插入，结构正确", async () => {
            mockCreate.mockResolvedValue({
                choices: [{ message: { role: "assistant", content: "SUMMARY" } }],
            });
            const messages = [
                sys("S"),
                u("u1"),
                aTc("a1", "tc1"),
                tool("t1", "tc1"),
                u("u2"),
                aTc("a2", "tc2"),
                tool("t2", "tc2"),
                u("u3"),
                a("a3"),
            ];
            const res = await compactMessages(messages, PROVIDER, { keepN: 3 });
            expect(res.compacted).toBe(true);
            // [system, summaryUser, a2, t2, u3, a3]
            expect(res.messages).toHaveLength(6);
            expect((res.messages[0] as Record<string, unknown>).role).toBe("system");
            expect((res.messages[1] as Record<string, unknown>).role).toBe("user");
            expect((res.messages[1] as { content: string }).content).toBe(
                COMPACT_HANDOFF_PREFIX + "SUMMARY"
            );
            expect((res.messages[2] as Record<string, unknown>).role).toBe("assistant");
            // tail 内 t2 的父 a2 同在 tail
            expect((res.messages[3] as Record<string, unknown>).role).toBe("tool");
            // 摘要调用禁用工具（payload 不含 tools）
            const payload = mockCreate.mock.calls[0][0] as { tools?: unknown };
            expect(payload.tools).toBeUndefined();
            expect(payload.max_tokens).toBe(4096);
        });

        it("tail[0] 为 user → 摘要合并进 tail[0]，避免 user→user 邻接", async () => {
            mockCreate.mockResolvedValue({
                choices: [{ message: { role: "assistant", content: "SUMMARY" } }],
            });
            const messages = [
                sys("S"),
                u("u1"),
                a("a1"),
                u("u2"),
                a("a2"),
                u("u3"), // tail[0] = u3（keepN=3）
                a("a3"),
                u("final"),
            ];
            const res = await compactMessages(messages, PROVIDER, { keepN: 3 });
            expect(res.compacted).toBe(true);
            // [system, merged(u3+summary), a3, u(final)]
            expect(res.messages).toHaveLength(4);
            const merged = res.messages[1] as { role: string; content: string };
            expect(merged.role).toBe("user");
            expect(merged.content.startsWith(COMPACT_HANDOFF_PREFIX + "SUMMARY")).toBe(true);
            expect(merged.content).toContain("u3"); // 原始 tail[0] 文本保留
        });

        it("对话太短（head 空）→ compacted=false，原样返回", async () => {
            const messages = [sys("S"), u("u1"), a("a1")];
            const res = await compactMessages(messages, PROVIDER);
            expect(res.compacted).toBe(false);
            expect(res.messages).toBe(messages);
            expect(mockCreate).not.toHaveBeenCalled();
        });

        it("有旧摘要 → 取出走 update 模式（previousSummary 注入 prompt）", async () => {
            mockCreate.mockResolvedValue({
                choices: [{ message: { role: "assistant", content: "NEW" } }],
            });
            const oldSummary = COMPACT_HANDOFF_PREFIX + "OLD";
            const messages = [
                sys("S"),
                u(oldSummary), // head[0] 是上一轮压缩留下的摘要
                a("a1"),
                u("u2"),
                a("a2"),
                u("u3"),
                a("a3"),
            ];
            await compactMessages(messages, PROVIDER, { keepN: 3 });
            const userPrompt = (mockCreate.mock.calls[0][0].messages as Array<{
                content: string;
            }>)[1].content;
            expect(userPrompt).toContain("<previous-summary>");
            expect(userPrompt).toContain("OLD");
            expect(userPrompt).toContain("<conversation>");
        });

        it("focus 注入摘要 prompt", async () => {
            mockCreate.mockResolvedValue({
                choices: [{ message: { role: "assistant", content: "S" } }],
            });
            const messages = [
                sys("S"),
                u("u1"),
                a("a1"),
                u("u2"),
                a("a2"),
                u("u3"),
                a("a3"),
            ];
            await compactMessages(messages, PROVIDER, { focus: "聚焦API设计", keepN: 3 });
            const userPrompt = (mockCreate.mock.calls[0][0].messages as Array<{
                content: string;
            }>)[1].content;
            expect(userPrompt).toContain("Additional focus: 聚焦API设计");
        });
    });
});
