import { describe, it, expect } from "vitest";
import { resolvePathWithEscape, createWorkspace } from "../src/workspace";

// B-013：逃逸标记（edit/write 逃逸走权限 ask，handler 经 __absFilePath 用已批准绝对路径）
describe("resolvePathWithEscape（B-013）", () => {
    const ws = createWorkspace("/tmp/anycode-escape-ws");
    it("区内路径 escaped=false", () => {
        const r = resolvePathWithEscape(ws, "a/b.txt");
        expect(r.escaped).toBe(false);
        expect(r.abs).toBe("/tmp/anycode-escape-ws/a/b.txt");
    });
    it("../ 与绝对路径逃逸 escaped=true", () => {
        expect(resolvePathWithEscape(ws, "../x").escaped).toBe(true);
        expect(resolvePathWithEscape(ws, "/etc/passwd").escaped).toBe(true);
    });
});
