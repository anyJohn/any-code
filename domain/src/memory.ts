/*
 * Memory —— 项目级 + 全局级两层记忆，纯 markdown。
 *
 * 写入由 save_memory 工具触发（LLM 主动调用）。
 * 读取在 getSystemMessage 合并全局 + 项目两层注入系统提示词。
 * 格式保持 markdown（## 时间戳 + content），兼容旧 Task/Result 条目（降级读取）。
 */

import fs from "fs";
import path from "path";
import type { Workspace } from "./workspace";
import { workspaceConfigDir, globalMemoryFile } from "./workspace";

export type MemoryScope = "project" | "global";

/** 项目级记忆文件：<rootPath>/.anycode/memory.md */
function projectMemoryFile(workspace: Workspace): string {
    return path.join(workspaceConfigDir(workspace), "memory.md");
}

/** 按 scope 解析记忆文件路径 */
function memoryFile(workspace: Workspace, scope: MemoryScope): string {
    return scope === "global" ? globalMemoryFile() : projectMemoryFile(workspace);
}

/**
 * 保存一条记忆到指定层（默认项目级）。
 * 条目格式：## ISO时间戳\n\ncontent\n\n---\n（content 由 LLM 自主组织）。
 */
export function saveMemory(
    workspace: Workspace,
    content: string,
    scope: MemoryScope = "project"
): void {
    const file = memoryFile(workspace, scope);
    const dir = path.dirname(file);
    const timestamp = new Date().toISOString();
    const entry = `## ${timestamp}\n\n${content}\n\n---\n\n`;

    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) {
        fs.appendFileSync(file, entry, "utf-8");
    } else {
        fs.writeFileSync(file, "# Agent Memory\n\n" + entry, "utf-8");
    }
}

/**
 * 合并加载全局 + 项目两层记忆，滑动窗口截断（默认 4000 字符）。
 * 全局在前、项目在后；窗口对合并后的全文做末尾截取，从最近的 ## 标题开始避免截断条目。
 * 兼容旧格式（Task/Result 模板条目）——纯文本读取不报错。
 */
export function loadMemory(workspace: Workspace, windowSize = 4000): string {
    const files = [globalMemoryFile(), projectMemoryFile(workspace)];
    let combined = "";
    for (const f of files) {
        if (fs.existsSync(f)) {
            combined += fs.readFileSync(f, "utf-8") + "\n";
        }
    }
    if (!combined.trim()) return "";

    if (combined.length <= windowSize) {
        return `\n# Previous context\n${combined}\n`;
    }

    const startIndex = combined.length - windowSize;
    const headerMatch = combined.lastIndexOf("## ", startIndex);
    const finalStartIndex = headerMatch !== -1 ? headerMatch : startIndex;
    return `\n# Previous context\n${combined.slice(finalStartIndex)}\n\n`;
}
