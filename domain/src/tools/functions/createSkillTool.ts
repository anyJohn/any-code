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
                            "技能名：小写字母/数字/连字符（如 pdf-merge）。也是目录名与 use_skill 的调用名",
                    },
                    description: {
                        type: "string",
                        description:
                            "一句话说明何时该用这个技能（会注入 <available_skills> 目录供模型判断）",
                    },
                    content: {
                        type: "string",
                        description: "技能正文（Markdown）：步骤、注意事项、脚本用法",
                    },
                    scope: {
                        type: "string",
                        enum: ["global", "project"],
                        description:
                            "global=~/.anycode/skills（跨项目，缺省）；project=<工作区>/.anycode/skills（仅本项目）",
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
                "name 非法：只允许小写字母/数字/连字符（1-64 位）——它同时是目录名与 use_skill 的调用名"
            );
        }
        if (!description) {
            return errResult(
                "description 不能为空（注入 <available_skills> 目录，供模型判断何时使用）"
            );
        }
        if (!content.trim()) return errResult("content 不能为空（技能正文 Markdown）");
        const dir =
            scope === "project"
                ? join(workspaceConfigDir(ctx.workspace), "skills")
                : join(globalConfigDir(), "skills");
        const skillDir = join(dir, name);
        if (existsSync(skillDir) || existsSync(join(dir, `${name}.md`))) {
            return errResult(
                `技能 "${name}" 已存在（${skillDir}）。如需修改：用 edit 工具直接编辑其 SKILL.md`
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
            content: `技能已创建：${skillDir}/SKILL.md（scope: ${scope}）\n下一条任务即可用：use_skill "${name}"`,
            data: { skill: name, scope, dir: skillDir },
        };
    },
    meta: { readOnly: false, concurrencySafe: false },
};
