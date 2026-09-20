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

describe("settings model 表单 ↔ config 转换（vision 往返）", () => {
    it("fromResponse：vision 缺省 false，显式 true 保留", () => {
        const { providers } = fromResponse(
            resp([
                { id: "gpt-4o", name: "GPT-4o", vision: true },
                { id: "deepseek-chat" },
            ])
        );
        expect(providers[0].models).toEqual([
            { id: "gpt-4o", name: "GPT-4o", vision: true },
            { id: "deepseek-chat", name: "", vision: false },
        ]);
    });

    it("toConfigShape：vision=true 落盘，false 不写字段（yaml 保持干净）", () => {
        const p = emptyProvider();
        p.name = "openai";
        p.models = [
            { id: "gpt-4o", name: "GPT-4o", vision: true },
            { id: "deepseek-chat", name: "", vision: false },
        ];
        const out = toConfigShape([p], "openai", []);
        expect(out.providers?.openai.models).toEqual([
            { id: "gpt-4o", name: "GPT-4o", vision: true },
            { id: "deepseek-chat", name: "" },
        ]);
    });

    it("往返：fromResponse → toConfigShape 后 vision 语义不变", () => {
        const { providers } = fromResponse(
            resp([{ id: "glm-4v", vision: true }])
        );
        const out = toConfigShape(providers, "openai", []);
        expect(out.providers?.openai.models).toEqual([
            { id: "glm-4v", name: "", vision: true },
        ]);
    });

    it("emptyProvider：新增模型默认无视觉能力", () => {
        expect(emptyProvider().models[0].vision).toBe(false);
    });
});
