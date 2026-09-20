import { describe, it, expect } from "vitest";
// 独立文件：不 mock openai——需要真 APIError 类（status 属性在 core/error.mjs:8 设置）
import { APIError } from "openai";
import { isImageUnsupportedError } from "../src/llm";

/**
 * SPEC-043 DEC-159：vision 缺省开后，未声明能力的模型可能被 provider 以 4xx 拒绝
 * image_url 块。判定必须准确命中"图片被拒"，且不误伤其他 4xx（否则会静默吃掉用户的图）。
 */
const apiErr = (status: number, message: string) =>
    APIError.generate(
        status,
        { error: { message } } as never,
        undefined,
        new Headers() as never
    );

describe("isImageUnsupportedError（SPEC-043 DEC-159）", () => {
    it("400 + 图片相关文案 → 命中（真 SDK 错误对象）", () => {
        const err = apiErr(
            400,
            "Invalid content type: image_url is not supported"
        );
        expect(err.status).toBe(400); // sanity：SDK 确实挂了 status
        expect(isImageUnsupportedError(err)).toBe(true);
    });

    it("401 鉴权错误（无图片文案）→ 不命中，不误降级", () => {
        expect(isImageUnsupportedError(apiErr(401, "Invalid API key"))).toBe(
            false
        );
    });

    it("400 参数错误但不涉及图片 → 不命中", () => {
        expect(
            isImageUnsupportedError(
                apiErr(400, "max_tokens must be greater than 0")
            )
        ).toBe(false);
    });

    it("429/5xx → 不命中（瞬时故障走既有重试路径，不吃掉图片）", () => {
        expect(
            isImageUnsupportedError(apiErr(429, "image_url rate limited"))
        ).toBe(false);
        expect(
            isImageUnsupportedError(apiErr(500, "image_url upstream error"))
        ).toBe(false);
    });

    it("无 status 的错误（网络类）→ 不命中", () => {
        expect(
            isImageUnsupportedError(new Error("fetch failed: image_url"))
        ).toBe(false);
    });
});
