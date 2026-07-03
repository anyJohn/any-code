import fs from "fs";
import path from "path";
import type { Workspace } from "./workspace";
import { workspaceConfigDir } from "./workspace";

/**
 * 加载 <workspace>/.anycode/rules/ 下的 markdown 文件，拼成 Prompt。
 * Rules 绑定项目：换 workspace，rules 随之切换。
 */
export function loadRule(workspace: Workspace): string {
    const ruleDir = path.join(workspaceConfigDir(workspace), "rules");
    if (!fs.existsSync(ruleDir)) {
        return "";
    }

    let files: string[];
    try {
        files = fs.readdirSync(ruleDir);
    } catch {
        return "";
    }
    const mdFiles = files.filter((file) => file.endsWith(".md"));
    if (mdFiles.length === 0) {
        return "";
    }

    mdFiles.sort(); // 按文件名排序，加载顺序一致

    const contents = mdFiles.map((file) => {
        return fs.readFileSync(path.join(ruleDir, file), "utf-8");
    });

    return `\n# Rule\n${contents.join("\n\n")}\n\n`;
}
