import { describe, it, expect } from "vitest";
import { serializeError } from "../src/type";

// SPEC-030 AC-001/002/003：domain 发出即 plain ErrorPayload，可序列化、live==persisted shape。

describe("serializeError（SPEC-030 AC-001/002/003）", () => {
    it("Error → plain ErrorPayload（非 Error 实例，JSON 序列化不丢字段）", () => {
        const err = new Error("boom");
        err.stack = "stack-trace";
        const p = serializeError(err);
        // 非原始 Error 实例（plain object）——raw Error 不可枚举，直接 stringify 会丢
        expect(p).not.toBeInstanceOf(Error);
        expect(p.message).toBe("boom");
        expect(p.name).toBe("Error");
        expect(p.stack).toBe("stack-trace");
        // JSON 往返不丢字段（AC-001/002 shape 完整）
        const round = JSON.parse(JSON.stringify({ data: p }));
        expect(round.data).toEqual({
            message: "boom",
            name: "Error",
            stack: "stack-trace",
        });
    });

    it("含 cause（live==persisted shape，I-001）", () => {
        const err = new Error("wrap", { cause: new Error("root") });
        const p = serializeError(err);
        expect(p.cause).toBe(String(new Error("root")));
        // 序列化后 cause 仍在（不再依赖 adapter replacer）
        const round = JSON.parse(JSON.stringify(p));
        expect(round.cause).toBe(String(new Error("root")));
    });

    it("非 Error thrown 值 → {message:String, name:'Error'}（无 stack/cause）", () => {
        expect(serializeError("a string")).toEqual({
            message: "a string",
            name: "Error",
        });
        expect(serializeError(42)).toEqual({ message: "42", name: "Error" });
        // 非 Error 路径不带 stack/cause
        expect(serializeError("x")).not.toHaveProperty("stack");
        expect(serializeError("x")).not.toHaveProperty("cause");
    });
});
