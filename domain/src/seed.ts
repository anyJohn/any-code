import fs from "node:fs";
import path from "node:path";
import { builtinRoot } from "./builtin";
import { globalConfigDir } from "./workspace";

/**
 * 内置技能 seed（随包技能 → 全局技能目录）。
 * "内置技能"没有特殊层：把 src/builtin/<name>/SKILL.md 所在目录（含 references/scripts/assets）
 * 递归拷进 ~/.anycode/skills/，落地即普通全局技能（用户可改、项目层可覆盖）。
 * 幂等：目标技能目录已存在则整体跳过（不覆盖用户修改）；连接器目录（无 SKILL.md）不 seed。
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
        if (!fs.existsSync(path.join(src, "SKILL.md"))) continue; // 连接器目录
        const dst = path.join(targetDir, e.name);
        if (fs.existsSync(dst)) continue; // 已有（可能是用户改过的）→ 不覆盖
        fs.mkdirSync(dst, { recursive: true });
        fs.cpSync(src, dst, { recursive: true });
        seeded.push(e.name);
    }
    return seeded;
}
