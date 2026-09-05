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

// SPEC-036：patch 解析——@@ 头推导旧行号/新行号
import { parsePatch } from "@/components/ChangesTab";

describe("parsePatch（变更 tab 行号）", () => {
    it("hunk 头后续行正确推导行号；+/−/上下文/元行分类正确", () => {
        const rows = parsePatch(
            [
                "diff --git a/a.txt b/a.txt",
                "index 111..222 100644",
                "--- a/a.txt",
                "+++ b/a.txt",
                "@@ -3,3 +3,3 @@",
                " ctx",
                "-old",
                "+new",
                "\\ No newline at end of file",
            ].join("\n")
        );
        const ctx = rows.find((r) => r.text === " ctx")!;
        expect(ctx.oldNo).toBe(3);
        expect(ctx.newNo).toBe(3);
        const del = rows.find((r) => r.text === "-old")!;
        expect(del.oldNo).toBe(4);
        expect(del.newNo).toBeNull();
        const add = rows.find((r) => r.text === "+new")!;
        expect(add.oldNo).toBeNull();
        expect(add.newNo).toBe(4);
        const meta = rows.find((r) => r.text.startsWith("\\"))!;
        expect(meta.oldNo).toBeNull();
        expect(meta.newNo).toBeNull();
    });
});

import { splitPatch } from "@/components/ChangesTab";

describe("splitPatch（变更 tab 按文件手风琴）", () => {
    it("按 diff --git 切分，取 b/ 侧路径", () => {
        const map = splitPatch(
            [
                "diff --git a/a.txt b/a.txt",
                "index 1..2 100644",
                "--- a/a.txt",
                "+++ b/a.txt",
                "@@ -1 +1 @@",
                "-x",
                "+y",
                "diff --git a/dir/b.md b/dir/b.md",
                "--- a/dir/b.md",
                "+++ b/dir/b.md",
                "@@ -1 +1 @@",
                "-p",
                "+q",
            ].join("\n")
        );
        expect([...map.keys()].sort()).toEqual(["a.txt", "dir/b.md"]);
        expect(map.get("dir/b.md")).toContain("+q");
        expect(map.get("dir/b.md")).not.toContain("-x");
    });
});
