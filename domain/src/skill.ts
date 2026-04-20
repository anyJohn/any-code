import fs from "fs";
import path from "path";

const SKILL_DIR = path.join(__dirname, "..", "/.agent/skills");

/**
 * 确保规则目录存在
 */
function ensureSkillDir(): void {
    if (!fs.existsSync(SKILL_DIR)) {
        fs.mkdirSync(SKILL_DIR, { recursive: true });
    }
}

export function loadSkills(): string {
    ensureSkillDir();
    const files = fs.readdirSync(SKILL_DIR);
    const mdFiles = files.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
        return "";
    }

    // 按文件名排序，确保加载顺序一致
    mdFiles.sort();

    const contents = mdFiles.map((file) => {
        const filePath = path.join(SKILL_DIR, file);
        return fs.readFileSync(filePath, "utf-8");
    });

    return `\n# Skill\n${contents.join("\n\n")}\n\n`;
}
