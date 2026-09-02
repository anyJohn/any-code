import { describe, it, expect } from "vitest";
import { validateToolArgs } from "../src/tools/validateArgs";
import type { ChatCompletionTool } from "openai/resources/index";

const tool = (parameters: unknown): ChatCompletionTool =>
    ({ type: "function", function: { name: "t", parameters } } as never);

describe("validateToolArgs（FR-10 参数校验）", () => {
    it("required 缺失 → 报错", () => {
        const err = validateToolArgs({}, tool({
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
        }));
        expect(err).toContain("command");
    });

    it("类型错误 → 报错（含路径）", () => {
        const err = validateToolArgs({ n: "x" }, tool({
            type: "object",
            properties: { n: { type: "number" } },
        }));
        expect(err).toContain("args.n");
    });

    it("嵌套 properties 与数组 items", () => {
        const schema = {
            type: "object",
            properties: {
                arr: { type: "array", items: { type: "string" } },
            },
        };
        expect(validateToolArgs({ arr: ["a", "b"] }, tool(schema))).toBeNull();
        expect(validateToolArgs({ arr: ["a", 1] }, tool(schema))).toContain("arr[1]");
    });

    it("enum 校验", () => {
        const schema = {
            type: "object",
            properties: { mode: { type: "string", enum: ["a", "b"] } },
        };
        expect(validateToolArgs({ mode: "a" }, tool(schema))).toBeNull();
        expect(validateToolArgs({ mode: "c" }, tool(schema))).toContain("mode");
    });

    it("无 schema / 非 object schema → 跳过（宽松）", () => {
        expect(validateToolArgs({ x: 1 }, tool(undefined))).toBeNull();
        expect(validateToolArgs({ x: 1 }, tool({ type: "string" }))).toBeNull();
    });

    it("合法参数 → null", () => {
        const schema = {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
        };
        expect(validateToolArgs({ command: "ls" }, tool(schema))).toBeNull();
    });
});
