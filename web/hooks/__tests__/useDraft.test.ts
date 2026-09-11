import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraft } from "../useDraft";

describe("useDraft", () => {
    it("切会话后草稿换为对应会话的存储值", () => {
        localStorage.setItem("anycode.draft.pk.s1", "会话一的草稿");
        localStorage.setItem("anycode.draft.pk.s2", "会话二的草稿");

        const { result, rerender } = renderHook(
            ({ sessionId }: { sessionId?: string }) =>
                useDraft("pk", sessionId),
            {
                initialProps: { sessionId: "s1" } as {
                    sessionId?: string;
                },
            }
        );
        expect(result.current.draft).toBe("会话一的草稿");

        // 切到会话二：草稿跟着换，不再残留上一会话的内容
        rerender({ sessionId: "s2" });
        expect(result.current.draft).toBe("会话二的草稿");

        // 切到无 sessionId（新对话）：空草稿
        rerender({ sessionId: undefined });
        expect(result.current.draft).toBe("");

        // setDraft 持久化到当前会话的 key
        act(() => result.current.setDraft("新草稿"));
        expect(localStorage.getItem("anycode.draft.pk.new")).toBe("新草稿");
    });
});
