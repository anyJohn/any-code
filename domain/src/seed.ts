import fs from "node:fs";
import path, { join } from "node:path";
import { builtinRoot } from "./builtin";
import { globalConfigDir } from "./workspace";

/**
 * 内置技能 seed + 升级策略（FR-25 ③，用户决策 2026-09-05）。
 *
 * seed：随包技能 → 全局技能目录，缺失即拷贝（幂等，不覆盖用户修改）。
 * 升级：SKILL.md frontmatter 带 version（语义化）+ changes（本版变更说明）——
 * 比对已装版本，内置更新且未被用户跳过 → 报告为待升级（**不动文件**）；
 * 升级动作经 upgradeSkill 显式覆盖；跳过记录在 .updates.json（用户偏好，持久）。
 *
 * UI：server GET /api/skills/updates + POST upgrade/skip；agent 启动时 Warning 提醒（每进程一次）。
 */

/** frontmatter 解析：version（缺省 0.0.0 = 不参与升级比对）+ changes 块。 */
function parseVersionInfo(content: string): { version: string; changes: string } {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "";
    const version = /^version:\s*(.+)$/m.exec(fm)?.[1]?.trim() ?? "0.0.0";
    let changes = "";
    const block = /^changes:\s*\|[^\n]*\n([\s\S]*?)(?=\n\S|\s*$)/m.exec(fm);
    if (block) {
        changes = block[1]
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .join("\n");
    } else {
        changes = /^changes:\s*(.+)$/m.exec(fm)?.[1]?.trim() ?? "";
    }
    return { version, changes };
}

/** 语义化版本比较（逐段数值）。返回 -1/0/1。 */
export function cmpVersion(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

export interface SkillUpdate {
    name: string;
    installedVersion: string;
    builtinVersion: string;
    changes: string;
}

const UPDATES_STATE_FILE = ".updates.json";

function readSkipped(skillsDir: string): Record<string, string> {
    try {
        const raw = fs.readFileSync(join(skillsDir, UPDATES_STATE_FILE), "utf-8");
        return JSON.parse(raw).skipped ?? {};
    } catch {
        return {};
    }
}

function writeSkipped(skillsDir: string, skipped: Record<string, string>): void {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
        join(skillsDir, UPDATES_STATE_FILE),
        JSON.stringify({ skipped }, null, 2),
        "utf-8"
    );
}

function listBuiltinSkills(builtinDir: string): string[] {
    if (!fs.existsSync(builtinDir)) return [];
    return fs
        .readdirSync(builtinDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(builtinDir, e.name, "SKILL.md")))
        .map((e) => e.name)
        .sort();
}

/** 内置技能相对已装技能的待升级清单（跳过用户明确跳过的版本）。纯检测，不动文件。 */
export function getSkillUpdates(
    builtinDir: string = builtinRoot(),
    skillsDir: string = path.join(globalConfigDir(), "skills")
): SkillUpdate[] {
    const skipped = readSkipped(skillsDir);
    const updates: SkillUpdate[] = [];
    for (const name of listBuiltinSkills(builtinDir)) {
        const builtin = parseVersionInfo(
            fs.readFileSync(path.join(builtinDir, name, "SKILL.md"), "utf-8")
        );
        if (builtin.version === "0.0.0") continue; // 无版本号不参与升级
        const installedFile = path.join(skillsDir, name, "SKILL.md");
        if (!fs.existsSync(installedFile)) continue; // 未安装（seed 会装）
        const installed = parseVersionInfo(fs.readFileSync(installedFile, "utf-8"));
        if (cmpVersion(builtin.version, installed.version) > 0 && (skipped[name] ?? "") !== builtin.version) {
            updates.push({
                name,
                installedVersion: installed.version,
                builtinVersion: builtin.version,
                changes: builtin.changes,
            });
        }
    }
    return updates;
}

/** 升级：内置版本覆盖已装副本（用户显式动作），并清除该技能的跳过记录。 */
export function upgradeSkill(
    name: string,
    builtinDir: string = builtinRoot(),
    skillsDir: string = path.join(globalConfigDir(), "skills")
): { ok: boolean; message: string } {
    if (!/^[\w.-]+$/.test(name)) return { ok: false, message: "技能名非法" };
    const src = path.join(builtinDir, name);
    if (!fs.existsSync(path.join(src, "SKILL.md"))) {
        return { ok: false, message: `内置技能 "${name}" 不存在` };
    }
    const dst = path.join(skillsDir, name);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(dst, { recursive: true });
    fs.cpSync(src, dst, { recursive: true });
    const skipped = readSkipped(skillsDir);
    if (skipped[name]) {
        delete skipped[name];
        writeSkipped(skillsDir, skipped);
    }
    const version = parseVersionInfo(fs.readFileSync(path.join(dst, "SKILL.md"), "utf-8")).version;
    return { ok: true, message: `${name} 已升级到 ${version}` };
}

/** 跳过某版本的升级提示（记录用户偏好，同版本不再提醒）。 */
export function skipSkillUpdate(
    name: string,
    version: string,
    skillsDir: string = path.join(globalConfigDir(), "skills")
): void {
    const skipped = readSkipped(skillsDir);
    skipped[name] = version;
    writeSkipped(skillsDir, skipped);
}

/**
 * 内置技能 seed（随包技能 → 全局技能目录）。
 * "内置技能"没有特殊层：把 src/builtin/<name>/SKILL.md 所在目录（含 references/scripts/assets）
 * 递归拷进 ~/.anycode/skills/，落地即普通全局技能（用户可改、项目层可覆盖）。
 * 幂等：目标技能目录已存在则整体跳过（不覆盖用户修改；升级走 upgradeSkill）。
 * 返回本次新 seed 的技能名列表。
 */
export function seedBuiltinSkills(
    builtinDir: string = builtinRoot(),
    targetDir: string = path.join(globalConfigDir(), "skills")
): string[] {
    if (!fs.existsSync(builtinDir)) return [];
    const seeded: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(builtinDir, { withFileTypes: true });
    } catch {
        return seeded;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!e.isDirectory()) continue;
        const src = path.join(builtinDir, e.name);
        if (!fs.existsSync(path.join(src, "SKILL.md"))) continue; // 非技能目录
        const dst = path.join(targetDir, e.name);
        if (fs.existsSync(dst)) continue; // 已有（可能是用户改过的）→ 不覆盖
        fs.mkdirSync(dst, { recursive: true });
        fs.cpSync(src, dst, { recursive: true });
        seeded.push(e.name);
    }
    return seeded;
}
