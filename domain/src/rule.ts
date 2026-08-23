import fs from "fs";
import path from "path";
import type { Workspace } from "./workspace";
import { workspaceConfigDir, globalConfigDir } from "./workspace";

function loadMdFiles(dir: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!fs.existsSync(dir)) return map;
    let files: string[];
    try {
        files = fs.readdirSync(dir);
    } catch {
        return map;
    }
    for (const file of files.filter((f) => f.endsWith(".md")).sort()) {
        map.set(file, fs.readFileSync(path.join(dir, file), "utf-8"));
    }
    return map;
}

/** 合并全局 + 项目两层 markdown 文件（同名项目覆盖全局，不同名并集） */
function mergeMdLayers(globalDir: string, projectDir: string): string[] {
    const map = loadMdFiles(globalDir);
    for (const [file, content] of loadMdFiles(projectDir)) {
        map.set(file, content); // 项目覆盖全局
    }
    return [...map.values()];
}

/** 加载全局 ~/.anycode/rules/ + 项目 .anycode/rules/ 的 markdown，拼成 Prompt */
export function loadRule(workspace: Workspace): string {
    const contents = mergeMdLayers(
        path.join(globalConfigDir(), "rules"),
        path.join(workspaceConfigDir(workspace), "rules")
    );
    return contents.length ? `\n# Rule\n${contents.join("\n\n")}\n\n` : "";
}
