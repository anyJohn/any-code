import { describe, it, expect } from "vitest";
import { matchAtFileToken } from "@/lib/atFile";

// SPEC-021 B-008：@ 前必须空格/行首才触发
describe("matchAtFileToken（SPEC-021 B-008）", () => {
    it("行首 @foo → foo", () => {
        expect(matchAtFileToken("@foo")).toBe("foo");
    });
    it("空格前 @foo → foo", () => {
        expect(matchAtFileToken("hi @foo")).toBe("foo");
    });
    it("@ 单独 → 空串（问题2：弹全量列表）", () => {
        expect(matchAtFileToken("@")).toBe("");
    });
    it("空格前 @ 单独 → 空串", () => {
        expect(matchAtFileToken("hi @")).toBe("");
    });
    it("无空格 文字@foo → null（问题3：不触发）", () => {
        expect(matchAtFileToken("hi@foo")).toBeNull();
    });
    it("无 @ → null", () => {
        expect(matchAtFileToken("hi there")).toBeNull();
    });
    it("@foo 后有空格 → null（@token 不在末尾）", () => {
        expect(matchAtFileToken("@foo bar")).toBeNull();
    });
});
