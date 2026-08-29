import fs from "node:fs";
import { join } from "node:path";
import type { Workspace } from "./workspace";
import { workspaceConfigDir, globalConfigDir } from "./workspace";

/**
 * 技能系统（RR-025 / SPEC-031 B-003~B-005）——整体替换旧"两层全量注入"。
 * 三层来源（优先级 高→低）：项目 .anycode/skills > 全局 ~/.anycode/skills > .agents ~/.agents/skills。
 * 技能是文件（目录制 <name>/SKILL.md，可带 references/scripts/assets 子目录；或平铺 <name>.md），
 * 无"内置技能"特殊层——随包自带技能由安装/首次启动 seed 进 ~/.anycode/skills/ 即复用同一机制。
 * 同名后层覆盖 + warning；prompt 只注入目录（name+description），正文经 use_skill 工具按需取（I-004）。
 */

/** 技能目录项：目录只含 name/description；content 只经 use_skill 工具返回。
 *  dir 仅目录制技能有值（<name>/SKILL.md 所在目录）——agent 可经 read/glob/explore 用它下面的 references/scripts/assets。 */
export interface SkillEntry {
    name: string;
    description: string;
    content: string;
    origin: "agents" | "global" | "project";
    dir?: string;
}

/** 目录 description 截断上限（SPEC-031 B-004 / Q-4，quota 后置）。 */
const DESC_LIMIT = 200;

/**
 * 解析技能 frontmatter（--- 围栏 YAML，取 name/description）。
 * 缺省回退：name=文件名（去 .md）；description=正文首个 # 标题，再退首行。
 * 目录 description 超限截断（+…）。
 */
export function parseSkillMeta(
    content: string,
    fallbackName: string
): { name: string; description: string } {
    let name = fallbackName.endsWith(".md")
        ? fallbackName.slice(0, -3)
        : fallbackName;
    let description = "";
    let body = content;
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
    if (m) {
        const fm = m[1];
        const nm = /^name:\s*(.+)$/m.exec(fm);
        const ds = /^description:\s*(.+)$/m.exec(fm);
        if (nm) name = nm[1].trim();
        if (ds) description = ds[1].trim();
        body = content.slice(m[0].length);
    }
    if (!description) {
        const h = /^#\s+(.+)$/m.exec(body);
        description = h ? h[1].trim() : body.split("\n")[0].slice(0, 100).trim();
    }
    if (description.length > DESC_LIMIT) {
        description = description.slice(0, DESC_LIMIT) + "…";
    }
    return { name, description };
}

/**
 * 层内加载：skills/<name>.md（平铺，兼容旧格式）或 skills/<name>/SKILL.md（目录制，
 * 可带 references/scripts/assets 等资源，条目附 dir）。目录制优先级同文件，混用合法。
 */
function loadDirSkills(
    dir: string,
    origin: SkillEntry["origin"]
): Map<string, SkillEntry> {
    const out = new Map<string, SkillEntry>();
    if (!fs.existsSync(dir)) return out;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        let file = "";
        let skillDir: string | undefined;
        if (e.isFile() && e.name.endsWith(".md")) {
            file = join(dir, e.name);
        } else if (e.isDirectory() && fs.existsSync(join(dir, e.name, "SKILL.md"))) {
            file = join(dir, e.name, "SKILL.md");
            skillDir = join(dir, e.name);
        }
        if (!file) continue;
        const fallback = e.isDirectory() ? e.name : e.name.slice(0, -3);
        const content = fs.readFileSync(file, "utf-8");
        const meta = parseSkillMeta(content, fallback);
        out.set(meta.name, {
            name: meta.name,
            description: meta.description,
            content,
            origin,
            dir: skillDir,
        });
    }
    return out;
}

/**
 * 三层技能合并（SPEC-031 B-003 / I-002）：确定性函数（项目 > 全局 > .agents）。
 * 同名后层覆盖 + warning（不静默，抄 opencode duplicate warning）。
 */
export function resolveSkills(workspace: Workspace): Map<string, SkillEntry> {
    const merged = new Map<string, SkillEntry>();
    const add = (e: SkillEntry) => {
        const prev = merged.get(e.name);
        if (prev && prev.origin !== e.origin) {
            console.warn(
                `[Skill] 同名技能 "${e.name}"：${e.origin} 覆盖 ${prev.origin}`
            );
        }
        merged.set(e.name, e);
    };
    // ~/.agents/skills → ~/.anycode/skills → <ws>/.anycode/skills（优先级升序）
    const layers: Array<[string, SkillEntry["origin"]]> = [
        [join(globalConfigDir(), "..", ".agents", "skills"), "agents"],
        [join(globalConfigDir(), "skills"), "global"],
        [join(workspaceConfigDir(workspace), "skills"), "project"],
    ];
    for (const [dir, origin] of layers) {
        for (const [, e] of loadDirSkills(dir, origin)) add(e);
    }
    return merged;
}

/**
 * 目录渲染（SPEC-031 B-004）：只含 name + description 的 <available_skills> 块。
 * 附一句"按需用 use_skill 工具读全文"训导（对齐生态 progressive disclosure）。
 */
export function renderSkillCatalog(entries: Iterable<SkillEntry>): string {
    const arr = [...entries];
    if (!arr.length) return "";
    const xml = arr
        .map(
            (e) =>
                `  <skill>\n    <name>${e.name}</name>\n    <description>${e.description}</description>\n  </skill>`
        )
        .join("\n");
    return [
        "\n# Available Skills",
        "任务匹配某技能 description 时，先调 use_skill 工具读它的全文再执行。",
        "<available_skills>",
        xml,
        "</available_skills>",
        "",
    ].join("\n");
}