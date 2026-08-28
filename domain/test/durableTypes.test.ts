import { describe, it, expect } from "vitest";
import { EventType, DURABLE_TYPES } from "../src/type";

// SPEC-030 AC-006 / B-004：durable 集定义（持久化作 reload 真值）vs ephemeral（live-only）。

describe("DURABLE_TYPES（SPEC-030 B-004/AC-006）", () => {
    const durable = [
        EventType.USER,
        EventType.ITERATION,
        EventType.THINKING,
        EventType.ASSISTANT,
        EventType.TOOL,
        EventType.USAGE,
        EventType.COMPACT,
        EventType.ERROR,
        EventType.WARNING,
        EventType.DONE,
        EventType.STOPPED,
    ];
    const ephemeral = [
        EventType.ASSISTANT_DELTA,
        EventType.TOOL_START,
        EventType.TOOL_PROGRESS,
        EventType.TOOL_ARG_PROGRESS,
        EventType.SYSTEM,
        EventType.PLANNING,
        EventType.INTERACTION,
    ];

    it("durable 事件在 DURABLE_TYPES 中（持久化作 reload 真值）", () => {
        for (const t of durable) expect(DURABLE_TYPES.has(t)).toBe(true);
    });

    it("ephemeral 事件不在 DURABLE_TYPES（live-only，不入盘）", () => {
        for (const t of ephemeral) expect(DURABLE_TYPES.has(t)).toBe(false);
    });
});
