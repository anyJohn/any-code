import fs from "node:fs";
import { join } from "node:path";
import type { Workspace } from "./workspace";
import { workspaceConfigDir } from "./workspace";
import { resolveSkills, type SkillEntry } from "./skill";

/**
 * 斜杠命令展开（SPEC-040 B-003 / DEC-144）：user 位系统注入的唯一 choke point。
 * web 不再自行展开——"/name args" 原样提交到内核边界，在此解析：
 * skill 优先（resolveSkills 四层来源）、custom commands（<ws>/.anycode/commands/<name>.md）次之，
 * 不匹配返回 null（当普通消息）。TUI/CLI 因此免费获得同能力。
 */

export interface SlashCommandMatch {
    name: string;
    /** 首行 "/name" 之后的参数（trim 过；无参数为空串） */
    args: string;
    body: string;
    kind: "skill" | "custom";
}

/** 解析首行 "/name args"——首行后的全部内容不属于命令（web 端展开格式兼容） */
export function parseSlashCommand(text: string): { name: string; args: string } | null {
    const nl = text.indexOf("\n");
    const first = text.slice(0, nl === -1 ? undefined : nl).trim();
    const m = first.match(/^\/([\w-]+)(?:\s+([\s\S]+))?$/);
    if (!m) return null;
    return { name: m[1], args: (m[2] ?? "").trim() };
}

/** 读单个 custom command 正文；不存在返回 null。 */
export function readCustomCommand(workspace: Workspace, name: string): string | null {
    const p = join(workspaceConfigDir(workspace), "commands", `${name}.md`);
    try {
        if (!fs.existsSync(p)) return null;
        return fs.readFileSync(p, "utf-8");
    } catch {
        return null;
    }
}

/**
 * 解析并展开斜杠命令。返回 null = 非命令（原样当用户消息）。
 * 展开格式与 web 旧客户端展开保持一致（prompt 行为零变化）：
 * `/name args\n\n<body>`。
 */
export function resolveSlashCommand(
    text: string,
    workspace: Workspace,
    skills?: Map<string, SkillEntry>
): SlashCommandMatch | null {
    const parsed = parseSlashCommand(text);
    if (!parsed) return null;
    const skill = skills?.get(parsed.name);
    if (skill) {
        return {
            name: parsed.name,
            args: parsed.args,
            body: skill.content,
            kind: "skill",
        };
    }
    const custom = readCustomCommand(workspace, parsed.name);
    if (custom !== null) {
        return {
            name: parsed.name,
            args: parsed.args,
            body: custom,
            kind: "custom",
        };
    }
    return null;
}

/** 展开后的任务：display = 用户原始输入（User 事件/历史用）；content = LLM 实际收到的内容。 */
export interface ExpandedTask {
    display: string;
    content: string;
    command?: { name: string; args?: string; body?: string };
}

/** submit 边界唯一入口：任意任务文本 → 展开（命令）或原样（普通消息）。 */
export function expandTask(
    text: string,
    workspace: Workspace,
    skills?: Map<string, SkillEntry>
): ExpandedTask {
    const match = resolveSlashCommand(text, workspace, skills);
    if (!match) return { display: text, content: text };
    // content 保留用户原始输入全文（多行亦可），正文追加其后——与 web 旧展开格式
    // "/name args\n\nbody" 对单行输入完全一致
    return {
        display: text,
        content: `${text}\n\n${match.body}`.trim(),
        command: {
            name: match.name,
            ...(match.args ? { args: match.args } : {}),
            body: match.body,
        },
    };
}
