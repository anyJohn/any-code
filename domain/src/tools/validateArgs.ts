import type { ChatCompletionTool } from "openai/resources/index";

/**
 * 工具参数校验（FR-10）：对 handler 执行前按工具 JSON Schema（parameters）
 * 校验 args，非法则拒绝执行、错误回传模型自纠。
 *
 * 覆盖工具 schema 实际使用的子集：object / properties / required /
 * string（含 enum）/ number / integer / boolean / array(items) /
 * 任意枚举。未识别的关键字忽略（宽松，避免过度拒绝）。
 */

interface JsonSchemaNode {
    type?: string | string[];
    properties?: Record<string, JsonSchemaNode>;
    required?: string[];
    items?: JsonSchemaNode;
    enum?: unknown[];
}

/** 单值校验；返回错误描述或 null。 */
function validateNode(value: unknown, schema: JsonSchemaNode, path: string): string | null {
    const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : undefined;

    // enum：命中枚举即通过（类型交给枚举自身）
    if (schema.enum) {
        if (!schema.enum.some((v) => v === value)) {
            return `${path} 必须是 ${schema.enum.map((v) => JSON.stringify(v)).join(" | ")} 之一`;
        }
        return null;
    }

    if (types && !types.some((t) => typeMatches(value, t))) {
        return `${path} 类型应为 ${types.join(" | ")}，实际为 ${jsonType(value)}`;
    }

    if (isRecord(value) && schema.properties) {
        for (const key of Object.keys(schema.properties)) {
            if (value[key] !== undefined) {
                const sub = validateNode(value[key], schema.properties[key], `${path}.${key}`);
                if (sub) return sub;
            }
        }
    }
    if (typeMatches(value, "array") && schema.items) {
        const arr = value as unknown[];
        for (let i = 0; i < arr.length; i++) {
            const sub = validateNode(arr[i], schema.items, `${path}[${i}]`);
            if (sub) return sub;
        }
    }
    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeMatches(value: unknown, type: string): boolean {
    switch (type) {
        case "object":
            return typeof value === "object" && value !== null && !Array.isArray(value);
        case "array":
            return Array.isArray(value);
        case "string":
            return typeof value === "string";
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "integer":
            return typeof value === "number" && Number.isInteger(value);
        case "boolean":
            return typeof value === "boolean";
        case "null":
            return value === null;
        default:
            return true; // 未知类型声明：宽松放行
    }
}

function jsonType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

/**
 * 校验工具调用 args 是否满足 schema.parameters。
 * 返回 null = 通过；返回 string = 面向模型的错误描述。
 * schema 缺失 / parameters 非 object schema → 跳过校验（宽松）。
 */
export function validateToolArgs(
    args: Record<string, unknown>,
    tool: ChatCompletionTool
): string | null {
    const fn = (tool as { function?: { parameters?: unknown } }).function;
    const parameters = fn?.parameters as JsonSchemaNode | undefined;
    if (!parameters || parameters.type !== "object") return null;

    for (const key of parameters.required ?? []) {
        if (args[key] === undefined) {
            return `缺少必填参数 ${key}（schema required）`;
        }
    }
    return validateNode(args, parameters, "args");
}
