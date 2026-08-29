import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveSkills, renderSkillCatalog, parseSkillMeta } from "../src/skill";
import { skillFunc } from "../src/tools/functions/skill";
import { createWorkspace } from "../src/workspace";
import type { ToolContext } from "../src/context";
import "../src/builtin";

// SPEC-031 AC-003 / AC-005 / AC-006（skill 目录注入 + use_skill 工具）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-skill-"));
const ws = createWorkspace(tmp);

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const projectSkills = path.join(tmp, ".anycode", "skills");
const writeSkill = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(projectSkills, rel)), {
        recursive: true,
    });
    fs.writeFileSync(path.join(projectSkills, rel), content);
};

describe("目录注入（B-003/B-004）", () => {
    it("技能是目录制（skill_name/SKILL.md + 可带 references/scripts/assets），条目带 dir 可寻址资源", () => {
        fs.mkdirSync(path.join(projectSkills, "my-skill", "references"), {
            recursive: true,
        });
        writeSkill(
            "my-skill/SKILL.md",
            `---\nname: my-skill\ndescription: 我的技能\n---\n# 技能正文\n步骤见 references/guide.md`
        );
        const map = resolveSkills(ws);
        const e = map.get("my-skill");
        expect(e?.origin).toBe("project");
        expect(e?.description).toBe("我的技能");
        expect(e?.content).toContain("技能正文");
        // dir 可读：references/scripts/assets 等资源所在目录（在 workspace 内，read 可直读）
        expect(e?.dir).toBe(path.join(projectSkills, "my-skill"));
    });

    it("平铺 <name>.md 与目录制并存（兼容旧格式）", () => {
        writeSkill("flat.md", "# Flat\n平铺正文");
        const map = resolveSkills(ws);
        const flat = map.get("flat");
        expect(flat?.content).toContain("平铺正文");
        expect(flat?.dir).toBeUndefined(); // 平铺无资源目录
        expect(map.get("my-skill")?.content).toContain("技能正文"); // 目录制仍在
    });

    it("AC-005 description 超 200 截断；正文只在 use_skill 工具里", () => {
        const longDesc = "x".repeat(300);
        writeSkill(
            "long.md",
            `---\nname: long\ndescription: ${longDesc}\n---\nLONG-BODY`
        );
        const map = resolveSkills(ws);
        const catalog = renderSkillCatalog(map.values());
        const entry = map.get("long");
        expect(entry?.description.length).toBe(201); // 200 + …(1)
        expect(entry?.description.endsWith("…")).toBe(true);
        expect(catalog).toContain(entry?.description ?? "");
        expect(catalog).not.toContain("LONG-BODY");
    });

    it("parseSkillMeta：frontmatter name/description；缺省回退 文件名/首标题", () => {
        const withFm = parseSkillMeta(
            "---\nname: mine\ndescription: my desc\n---\n# Title\nbody",
            "file"
        );
        expect(withFm.name).toBe("mine");
        expect(withFm.description).toBe("my desc");
        const fallback = parseSkillMeta("# Fallback Title\nbody", "file.md");
        expect(fallback.name).toBe("file"); // 去 .md
        expect(fallback.description).toBe("Fallback Title");
        // 目录制 fallback 名 = 目录名
        const dir = parseSkillMeta("# Dir Body", "dir-name");
        expect(dir.name).toBe("dir-name");
        expect(dir.description).toBe("Dir Body");
    });
});

describe("use_skill 工具（B-005 / AC-006）", () => {
    it("返回技能全文 <skill_content>", async () => {
        const map = resolveSkills(ws);
        const ctx = { skills: map } as unknown as ToolContext;
        const out = await skillFunc({ name: "my-skill" }, ctx);
        expect(out).toContain("<skill_content>");
        expect(out).toContain("<name>my-skill</name>");
        expect(out).toContain("技能正文"); // 全文可达
    });

    it("目录制技能返回时附带 <dir>（resources 可寻址）", async () => {
        const map = resolveSkills(ws);
        const ctx = { skills: map } as unknown as ToolContext;
        const out = await skillFunc({ name: "my-skill" }, ctx);
        expect(out).toContain(
            `<dir>${path.join(projectSkills, "my-skill")}</dir>`
        );
        expect(out).toContain("references/guide.md");
    });

    it("未知技能 → 明确错误 + 可用列表", async () => {
        const map = resolveSkills(ws);
        const ctx = { skills: map } as unknown as ToolContext;
        const out = await skillFunc({ name: "nope" }, ctx);
        expect(out).toMatch(/不存在/);
        expect(out).toContain("可用技能");
    });

    it("空 name / 无 ctx.skills → 明确错误（不崩）", async () => {
        const ctx = {} as unknown as ToolContext;
        expect(await skillFunc({}, ctx)).toMatch(/name 不能为空/);
        expect(await skillFunc({ name: "x" }, ctx)).toMatch(/不存在/);
    });
});