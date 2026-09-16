import { describe, expect, it } from "vitest";
import type { AgentEvent, EventType } from "../sseEvents";
import {
    liveActiveTool,
    RENDER_RULES,
    toRenderItems,
} from "../renderItems";

/** SPEC-040 B-004：渲染规则表不变式 + overlay（liveActiveTool）行为。 */

const ALL_TYPES: EventType[] = [
    "System", "User", "Iteration", "Thinking", "Assistant",
    "AssistantDelta", "Tool", "ToolStart", "ToolProgress",
    "ToolArgProgress", "Usage", "Compact", "Interaction", "Planning",
    "Permission", "PermissionAsk", "Error", "Warning", "Done", "Stopped",
];

describe("RENDER_RULES（SPEC-040）", () => {
    it("每个事件类型都有渲染归类（无遗漏，与 domain 协议表对齐）", () => {
        for (const t of ALL_TYPES) {
            expect(["turn", "single", "meta", "drop"]).toContain(RENDER_RULES[t]);
        }
    });

    it("single 集合与重构前硬编码列表逐元素相等", () => {
        const LEGACY_SINGLE: EventType[] = [
            "System", "User", "Done", "Stopped",
            "Compact", "Error", "Warning", "Permission",
        ];
        const singles = ALL_TYPES.filter((t) => RENDER_RULES[t] === "single");
        expect(singles.sort()).toEqual([...LEGACY_SINGLE].sort());
    });
});

describe("liveActiveTool（overlay 收敛）", () => {
    const ev = (type: EventType, extra?: Record<string, unknown>): AgentEvent =>
        ({ id: "e", timestamp: 0, message: "bash", type, ...extra } as AgentEvent);

    it("无 transient 事件 → 无活动工具", () => {
        expect(liveActiveTool([ev("Tool", { data: { name: "bash", args: {}, result: "ok" } })])).toBeNull();
    });

    it("ToolStart → running；ToolProgress 追加；durable Tool 落地 → 影子消散", () => {
        const events = [
            ev("ToolStart", { data: { name: "bash", args: {} } }),
            ev("ToolProgress"),
            ev("ToolProgress"),
        ];
        expect(liveActiveTool(events)).toEqual({
            phase: "running",
            name: "bash",
            progress: "bashbash",
        });
        // 正身落地 → overlay 清除
        events.push(ev("Tool", { data: { name: "bash", args: {}, result: "done" } }));
        expect(liveActiveTool(events)).toBeNull();
    });

    it("ToolArgProgress（未到 ToolStart）→ generating 防冻屏", () => {
        expect(
            liveActiveTool([ev("ToolArgProgress", { data: { bytes: 42 } })])
        ).toEqual({ phase: "generating", name: "bash", bytes: 42 });
    });
});

describe("表驱动 toRenderItems 等价性", () => {
    it("meta/drop 事件不打断回合块，single 事件切分", () => {
        const events: AgentEvent[] = [
            { id: "1", timestamp: 1, message: "m", type: "Iteration" } as AgentEvent,
            { id: "2", timestamp: 2, message: "hi", type: "Assistant" } as AgentEvent,
            { id: "3", timestamp: 3, message: "p", type: "ToolProgress" } as AgentEvent,
            { id: "4", timestamp: 4, message: "x", type: "Planning" } as AgentEvent,
            { id: "5", timestamp: 5, message: "done", type: "Done" } as AgentEvent,
        ];
        const items = toRenderItems(events);
        // ToolProgress(meta)/Planning(drop) 不切分；Done(single) 切分并独立成项
        expect(items.filter((i) => i.kind === "turn")).toHaveLength(1);
        expect(items.filter((i) => i.kind === "single").map((i) => (i as { event: AgentEvent }).event.type)).toEqual(["Done"]);
    });
});
