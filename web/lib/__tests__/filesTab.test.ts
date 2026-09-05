import { describe, it, expect } from "vitest";
import { buildTree } from "@/components/FilesTab";
import type { FileEntry } from "@/hooks/useFileReference";

// SPEC-036 B-008：平铺路径 → 前缀树
describe("buildTree（SPEC-036）", () => {
    it("平铺列表按 / 拆分建树；目录与文件归位", () => {
        const tree = buildTree([
            { path: "src/a.ts", name: "a.ts" },
            { path: "src/lib/b.ts", name: "b.ts" },
            { path: "README.md", name: "README.md" },
        ]);
        const src = tree.children.get("src")!;
        expect(src.isFile).toBe(false);
        expect(src.children.get("lib")!.isFile).toBe(false);
        expect(src.children.get("a.ts")!.isFile).toBe(true);
        expect(src.children.get("lib")!.children.get("b.ts")!.path).toBe("src/lib/b.ts");
        expect(tree.children.get("README.md")!.isFile).toBe(true);
    });

    it("同目录同段合并（多条路径共享前缀）", () => {
        const tree = buildTree([
            { path: "p/x.ts", name: "x.ts" },
            { path: "p/x.ts", name: "x.ts" },
        ]);
        expect(tree.children.get("p")!.children.size).toBe(1);
    });
});

// SPEC-036 B-011：引用格式 path / path:10-20
describe("文件引用格式（SPEC-036 B-011）", () => {
    const format = (c: FileEntry): string =>
        c.lines ? `${c.path}:${c.lines[0]}-${c.lines[1]}` : c.path;

    it("整文件引用 = path；行引用 = path:10-20", () => {
        expect(format({ path: "a/b.ts", name: "b.ts" })).toBe("a/b.ts");
        expect(
            format({ path: "a/b.ts", name: "b.ts", lines: [10, 20] })
        ).toBe("a/b.ts:10-20");
    });
});
