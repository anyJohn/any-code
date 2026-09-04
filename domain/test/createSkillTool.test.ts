import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillTool } from "../src/tools/functions/createSkillTool";
import { resolveSkills } from "../src/skill";
import { createWorkspace } from "../src/workspace";
import type { ToolContext } from "../src/context";

// FR-25 ② / 用户决策 2026-09-04：agent 安装技能的正规通道——
// 落点正确（不再 skills/skills 双层嵌套）、拒覆盖、名字防路径逃逸、写完即热生效。

let home: string;
let wsRoot: string;
const ORIG_HOME = process.env.HOME;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "anycode-csk-"));
    wsRoot = mkdtempSync(join(tmpdir(), "anycode-csk-ws-"));
    process.env.HOME = home;
});
afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(wsRoot, { recursive: true, force: true });
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
});

const ctx = (): ToolContext =>
    ({ workspace: createWorkspace(wsRoot), eventStream: { submit: () => {} }, signal: new AbortController().signal }) as ToolContext;

describe("create_skill（FR-25 ②）", () => {
    it("global 落点 ~/.anycode/skills/<name>/SKILL.md（frontmatter 齐全），resolveSkills 立即可用", async () => {
        const r = await createSkillTool.handler(
            { name: "pdf-merge", description: "合并 PDF 文件", content: "# 步骤\n1. …", scope: "global" },
            ctx()
        );
        const skillFile = join(home, ".anycode", "skills", "pdf-merge", "SKILL.md");
        expect(existsSync(skillFile)).toBe(true);
        expect(readFileSync(skillFile, "utf-8")).toContain('name: pdf-merge');
        const m = resolveSkills(createWorkspace(wsRoot));
        expect(m.get("pdf-merge")?.origin).toBe("global");
        expect((r as { content: string }).content).toContain('use_skill "pdf-merge"');
    });

    it("project 落点 <ws>/.anycode/skills/，origin=project", async () => {
        await createSkillTool.handler(
            { name: "ws-only", description: "d", content: "c", scope: "project" },
            ctx()
        );
        const m = resolveSkills(createWorkspace(wsRoot));
        expect(m.get("ws-only")?.origin).toBe("project");
    });

    it("拒覆盖；name 防路径逃逸（/ 与 .. 拒绝）", async () => {
        const args = { name: "dup", description: "d", content: "c" };
        await createSkillTool.handler(args, ctx());
        const again = await createSkillTool.handler(args, ctx());
        expect((again as { content: string }).content).toContain("已存在");
        const escape = await createSkillTool.handler({ ...args, name: "../evil" }, ctx());
        expect((escape as { content: string }).content).toContain("name 非法");
        expect(existsSync(join(home, ".anycode", "evil"))).toBe(false);
    });

    it("缺 description / content → 明确错误", async () => {
        const a = await createSkillTool.handler({ name: "n1", content: "c" }, ctx());
        expect((a as { content: string }).content).toContain("description");
        const b = await createSkillTool.handler({ name: "n2", description: "d" }, ctx());
        expect((b as { content: string }).content).toContain("content");
    });
});
