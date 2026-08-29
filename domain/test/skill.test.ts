import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveSkills, renderSkillCatalog, parseSkillMeta } from "../src/skill";
import { skillFunc } from "../src/tools/functions/skill";
import { createWorkspace } from "../src/workspace";
import type { Config } from "../src/config";
import type { ToolContext } from "../src/context";
import "../src/builtin";

// SPEC-031 AC-003 / AC-005 / AC-006（skill 目录注入 + skill 工具）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-skill-"));
const ws = createWorkspace(tmp);

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const cfg = (abilities: Config["abilities"]) =>
    ({ abilities } as unknown as Config);

describe("目录注入（B-003/B-004）", () => {
    it("AC-003 内置 browser-use 启用 → 目录含其 name，正文不进目录", () => {
        const map = resolveSkills(
            ws,
            cfg({ "browser-use": { enabled: true } })
        );
        const catalog = renderSkillCatalog(map.values());
        expect(catalog).toContain("<name>browser-use</name>");
        expect(catalog).not.toContain("工作流程"); // 正文不注入（I-004）
        expect(map.get("browser-use")?.origin).toBe("builtin");
    });

    it("AC-005 description 超 200 截断；正文只在 skill 工具里", () => {
        const longDesc = "x".repeat(300);
        fs.mkdirSync(path.join(tmp, ".anycode", "skills"), { recursive: true });
        fs.writeFileSync(
            path.join(tmp, ".anycode", "skills", "long.md"),
            `---\nname: long\ndescription: ${longDesc}\n---\nLONG-BODY`
        );
        const map = resolveSkills(ws, cfg({}));
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
    });
});

describe("skill 工具（B-005 / AC-006）", () => {
    it("返回技能全文 <skill_content>", async () => {
        const map = resolveSkills(
            ws,
            cfg({ "browser-use": { enabled: true } })
        );
        const ctx = { skills: map } as unknown as ToolContext;
        const out = await skillFunc({ name: "browser-use" }, ctx);
        expect(out).toContain("<skill_content>");
        expect(out).toContain("<name>browser-use</name>");
        expect(out).toContain("工作流程"); // 全文可达
    });

    it("未知技能 → 明确错误 + 可用列表", async () => {
        const map = resolveSkills(ws, cfg({}));
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