import { describe, expect, it } from "vitest";
import { DURABLE_TYPES, eventProtocol, type EventType } from "../src/type";

/** SPEC-040：事件协议表派生正确性（AC-001）+ shadowOf 不变量（I-001）。 */

// 重构前硬编码的 durable 集合（SPEC-030 真值）——快照比对用
const LEGACY_DURABLE: EventType[] = [
    "User",
    "Iteration",
    "Thinking",
    "Assistant",
    "Tool",
    "Usage",
    "Compact",
    "Planning",
    "Permission",
    "Error",
    "Warning",
    "Done",
    "Stopped",
];

describe("事件协议表（SPEC-040）", () => {
    it("派生 DURABLE_TYPES 与重构前硬编码逐元素相等", () => {
        expect([...DURABLE_TYPES].sort()).toEqual([...LEGACY_DURABLE].sort());
    });

    it("每个 EventType 都有协议声明（无遗漏）", () => {
        const ALL: EventType[] = [
            "System", "User", "Iteration", "Thinking", "Assistant",
            "AssistantDelta", "Tool", "ToolStart", "ToolProgress",
            "ToolArgProgress", "Usage", "Compact", "Interaction", "Planning",
            "Permission", "PermissionAsk", "Error", "Warning", "Done", "Stopped",
        ];
        for (const t of ALL) {
            expect(() => eventProtocol(t)).not.toThrow();
            expect(typeof eventProtocol(t).durable).toBe("boolean");
        }
    });

    it("I-001：shadowOf 的目标必须 durable", () => {
        const ALL: EventType[] = [
            "System", "User", "Iteration", "Thinking", "Assistant",
            "AssistantDelta", "Tool", "ToolStart", "ToolProgress",
            "ToolArgProgress", "Usage", "Compact", "Interaction", "Planning",
            "Permission", "PermissionAsk", "Error", "Warning", "Done", "Stopped",
        ];
        for (const t of ALL) {
            const p = eventProtocol(t);
            if (p.shadowOf) {
                expect(DURABLE_TYPES.has(p.shadowOf), `${t} shadowOf ${p.shadowOf}`).toBe(true);
            }
        }
    });

    it("已知影子关系（overlay 语义锚点）", () => {
        expect(eventProtocol("AssistantDelta")).toEqual({ durable: false, shadowOf: "Assistant" });
        expect(eventProtocol("ToolProgress")).toEqual({ durable: false, shadowOf: "Tool" });
    });
});
