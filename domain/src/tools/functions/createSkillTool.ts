import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolContext } from "../../context";
import { globalConfigDir, workspaceConfigDir } from "../../workspace";
import { errResult } from "./webHttp";
import type { Tool } from "../index";

/**
 * create_skill —— 把可复用经验固化为技能（FR-25 ②，用户决策 2026-09-04）。
 * 动因：让 agent"安装技能"时它自己猜路径，装出了 skills/skills/ 双层嵌套——
 * 正规通道保证落点正确（<scope>/skills/<name>/SKILL.md，frontmatter 齐全）、
 * 拒绝覆盖、名字防路径逃逸。写入后下一条任务即可用（ctx.skills 每任务重建）。
 * 非 readOnly：写技能目录文件，标准权限模式下走 ask。
 */

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const createSkillTool: Tool = {
    schema: {
        type: "function",
        function: {
            name: "create_skill",
            description:
                "Create a reusable skill from experience (writes <scope>/skills/<name>/SKILL.md). Use when a workflow proves repeatable. Takes effect on the next task; never guess install paths yourself.",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description:
                            "Skill name: lowercase letters/digits/hyphens (e.g. pdf-merge). Also the directory name and the use_skill call name",
                    },
                    description: {
                        type: "string",
                        description:
                            "One sentence describing when to use this skill (injected into <available_skills> so the model can decide)",
                    },
                    content: {
                        type: "string",
                        description: "Skill body (Markdown): steps, caveats, script usage",
                    },
                    scope: {
                        type: "string",
                        enum: ["global", "project"],
                        description:
                            "global=~/.anycode/skills (cross-project, default); project=<workspace>/.anycode/skills (this project only)",
                    },
                },
                required: ["name", "description", "content"],
            },
        },
    },
    handler: async (rawArgs, ctx: ToolContext) => {
        const args = rawArgs as {
            name?: string;
            description?: string;
            content?: string;
            scope?: string;
        };
        const name = (args?.name ?? "").trim();
        const description = (args?.description ?? "").trim().replace(/\s+/g, " ");
        const content = typeof args?.content === "string" ? args.content : "";
        const scope = args?.scope === "project" ? "project" : "global";
        if (!NAME_RE.test(name)) {
            return errResult(
                "Invalid name: only lowercase letters/digits/hyphens (1-64 chars) — it is both the directory name and the use_skill call name"
            );
        }
        if (!description) {
            return errResult(
                "description must not be empty (injected into <available_skills> so the model can decide when to use it)"
            );
        }
        if (!content.trim()) return errResult("content must not be empty (the skill body, Markdown)");
        const dir =
            scope === "project"
                ? join(workspaceConfigDir(ctx.workspace), "skills")
                : join(globalConfigDir(), "skills");
        const skillDir = join(dir, name);
        if (existsSync(skillDir) || existsSync(join(dir, `${name}.md`))) {
            return errResult(
                `Skill "${name}" already exists (${skillDir}). To modify it, edit its SKILL.md directly with the edit tool`
            );
        }
        try {
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(
                join(skillDir, "SKILL.md"),
                `---\nname: ${name}\ndescription: ${description}\n---\n\n${content.trim()}\n`,
                "utf-8"
            );
        } catch (e) {
            return errResult(String(e instanceof Error ? e.message : e));
        }
        return {
            content: `Skill created: ${skillDir}/SKILL.md (scope: ${scope})\nAvailable from the next task onward: use_skill "${name}"`,
            data: { skill: name, scope, dir: skillDir },
        };
    },
    meta: { readOnly: false, concurrencySafe: false },
};
