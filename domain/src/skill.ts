import fs from "fs";
import path from "path";
import type { Workspace } from "./workspace";
import { workspaceConfigDir } from "./workspace";

/**
 * 加载 <workspace>/.anycode/skills/ 下的 markdown 文件，拼成 Prompt。
 */
export function loadSkills(workspace: Workspace): string {
    const skillDir = path.join(workspaceConfigDir(workspace), "skills");
    if (!fs.existsSync(skillDir)) {
        return "";
    }

    let files: string[];
    try {
        files = fs.readdirSync(skillDir);
    } catch {
        return "";
    }
    const mdFiles = files.filter((file) => file.endsWith(".md"));
    if (mdFiles.length === 0) {
        return "";
    }

    mdFiles.sort();

    const contents = mdFiles.map((file) => {
        return fs.readFileSync(path.join(skillDir, file), "utf-8");
    });

    return `\n# Skill\n${contents.join("\n\n")}\n\n`;
}
