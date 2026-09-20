import { describe, expect, it } from "vitest";
import {
    emptyProvider,
    fromResponse,
    toConfigShape,
    type ConfigResponse,
} from "../model";

/** 构造最小 ConfigResponse（apiKey 已脱敏形状）。 */
function resp(
    models: { id: string; name?: string; vision?: boolean }[]
): ConfigResponse {
    return {
        providers: {
            openai: {
                apiKey: "sk-****",
                models,
                defaultModel: models[0]?.id ?? "",
                streaming: true,
            },
        },
        default: "openai",
        mcp: {},
    };
}

describe("settings model 表单 ↔ config 转换（vision 往返，DEC-159 缺省开）", () => {
    it("fromResponse：vision 缺省 true，显式 false 保留", () => {
        const { providers } = fromResponse(
            resp([
                { id: "gpt-4o", name: "GPT-4o" },
                { id: "deepseek-chat", vision: false },
            ])
        );
        expect(providers[0].models).toEqual([
            { id: "gpt-4o", name: "GPT-4o", vision: true },
            { id: "deepseek-chat", name: "", vision: false },
        ]);
    });

    it("toConfigShape：vision=false 落盘，true 不写字段（缺省即 true，yaml 保持干净）", () => {
        const p = emptyProvider();
        p.name = "openai";
        p.models = [
            { id: "gpt-4o", name: "GPT-4o", vision: true },
            { id: "deepseek-chat", name: "", vision: false },
        ];
        const out = toConfigShape([p], "openai", []);
        expect(out.providers?.openai.models).toEqual([
            { id: "gpt-4o", name: "GPT-4o" },
            { id: "deepseek-chat", name: "", vision: false },
        ]);
    });

    it("往返：fromResponse → toConfigShape 后 vision 语义不变", () => {
        const { providers } = fromResponse(
            resp([{ id: "glm-4v", vision: false }])
        );
        const out = toConfigShape(providers, "openai", []);
        expect(out.providers?.openai.models).toEqual([
            { id: "glm-4v", name: "", vision: false },
        ]);
    });

    it("emptyProvider：新增模型默认具备视觉能力", () => {
        expect(emptyProvider().models[0].vision).toBe(true);
    });
});
