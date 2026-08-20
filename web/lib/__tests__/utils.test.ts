import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

/**
 * FE-001 冒烟测试：验证测试基础设施（vitest + jsdom + @ alias + ts）可用。
 * covers TEST-001 TC-001.3 的前置（import 链通）。
 */
describe("lib/utils cn", () => {
    it("合并类并去重", () => {
        expect(cn("p-2", "p-4", "text-sm")).toBe("p-4 text-sm");
    });
    it("条件类", () => {
        expect(cn("a", false, "b", undefined)).toBe("a b");
    });
});
