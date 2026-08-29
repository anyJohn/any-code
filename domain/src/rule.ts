import fs from "node:fs";
import path from "node:path";
import type { Workspace } from "./workspace";
import { globalConfigDir } from "./workspace";

/**
 * 规则系统（RR-025 D-6 / SPEC-031 B-006）——整体替换旧 .anycode/rules/ 多文件机制（superseded）。
 * 规则 = AGENTS.md 文件：全局 ~/.anycode/AGENTS.md、~/.agents/AGENTS.md、项目 <workspaceDir>/AGENTS.md。
 * additive 全量注入（更具体的优先：全局 → .agents → 项目）；同目录 AGENTS.override.md 优先于 AGENTS.md（DEC-031-3）。
 * 旧 .anycode/rules/ 永不再读取（SPEC-031 I-003，破坏性不兼容）。
 */

/** 同目录候选序：override 优先于 AGENTS.md */
const CANDIDATES = ["AGENTS.override.md", "AGENTS.md"];

function readFirstExisting(
    dir: string
): { file: string; content: string } | null {
    for (const name of CANDIDATES) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) {
            return { file: p, content: fs.readFileSync(p, "utf-8").trim() };
        }
    }
    return null;
}

/** 规则源（broadest → most specific）：全局 → .agents → 项目。 */
function ruleSources(workspace: Workspace): Array<{ dir: string; origin: string }> {
    return [
        { dir: globalConfigDir(), origin: "global" }, // ~/.anycode/AGENTS.md
        {
            dir: path.join(globalConfigDir(), "..", ".agents"),
            origin: "agents",
        }, // ~/.agents/AGENTS.md
        { dir: workspace.rootPath, origin: "project" }, // <workspaceDir>/AGENTS.md
    ];
}

/**
 * 加载 AGENTS.md 规则（additive，同内容去重），拼成 Prompt。
 * each 块带来源路径 + 层标注；附"更具体优先"措辞（对齐业界共识，排序即优先级）。
 * SPEC-031 B-006 / AC-007。
 */
export function loadRule(workspace: Workspace): string {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const { dir, origin } of ruleSources(workspace)) {
        const hit = readFirstExisting(dir);
        if (!hit) continue;
        if (seen.has(hit.content)) continue;
        seen.add(hit.content);
        parts.push(
            `Instructions from: ${hit.file} [${origin}]\n${hit.content}`
        );
    }
    return parts.length
        ? `\n# Rules\n更具体的规则优先于更宽泛的（全局 < .agents < 项目）。\n${parts.join(
              "\n\n"
          )}\n\n`
        : "";
}