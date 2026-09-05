import { describe, it, expect } from "vitest";
import { toolNotes } from "../src/prompt";

// 用户需求 2026-09-04：工具关闭时其 system prompt 引导段不注入。
describe("toolNotes 工具门控注入", () => {
    it("update_memory 开 → Memory 段在；关 → 不注入", () => {
        expect(toolNotes(new Set(["update_memory"]))).toContain("# Memory");
        expect(toolNotes(new Set())).not.toContain("# Memory");
    });

    it("web_fetch / web_search 分别开关 → Web 段只列可用能力", () => {
        const both = toolNotes(new Set(["web_fetch", "web_search"]));
        expect(both).toContain("# Web");
        expect(both).toContain("web_search");
        expect(both).toContain("web_fetch");
        expect(both).toContain("read live at call time");

        const fetchOnly = toolNotes(new Set(["web_fetch"]));
        expect(fetchOnly).toContain("web_fetch");
        expect(fetchOnly).not.toContain("web_search");

        expect(toolNotes(new Set())).not.toContain("# Web");
    });

    it("browser_use 关 → Browser 段不注入；开 → 含 action 说明与现读语义", () => {
        expect(toolNotes(new Set())).not.toContain("# Browser");
        const on = toolNotes(new Set(["browser_use"]));
        expect(on).toContain("# Browser");
        expect(on).toContain("action=navigate");
        expect(on).toContain("read live at call time");
    });
});
