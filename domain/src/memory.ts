/**
 * Todo List
 * - 基于RAG的向量记忆检索,扩充记忆容量
 * - 记忆检索工具, Agent 自己检索记忆
 * - 记忆压缩/记忆蒸馏,自动压缩旧记忆，丢弃细节和过时的信息，保留核心内容和重要事件
 * - 分层记忆，分层为 工作记忆 -> 短期记忆 -> 长期记忆,拥有不同的信息密度和保存时间
 */

import fs from "fs";
import path from "path";
import type { Workspace } from "./workspace";
import { workspaceConfigDir } from "./workspace";

/**
 * 保存记忆到 <workspace>/.anycode/memory.md
 */
export function saveMemory(
    task: string,
    result: string,
    workspace: Workspace
): void {
    const dir = workspaceConfigDir(workspace);
    const file = path.join(dir, "memory.md");
    const timestamp = new Date().toISOString();
    const entry = `## ${timestamp}\n\n**Task:** ${task}\n\n**Result:**\n${result}\n\n---\n\n`;

    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) {
        fs.appendFileSync(file, entry, "utf-8");
    } else {
        fs.writeFileSync(file, "# Agent Memory\n\n" + entry, "utf-8");
    }
}

/**
 * 通过滑动窗口方式加载 <workspace>/.anycode/memory.md
 * @param windowSize 窗口大小（字符数），默认 1000
 */
export function loadMemory(workspace: Workspace, windowSize = 1000): string {
    const file = path.join(workspaceConfigDir(workspace), "memory.md");
    if (!fs.existsSync(file)) {
        return "";
    }

    const content = fs.readFileSync(file, "utf-8");
    if (content.length <= windowSize) {
        return content;
    }

    // 从末尾截取指定大小的内容
    const startIndex = content.length - windowSize;
    // 尝试从最近的标题开始，避免截断中间的内容
    const headerMatch = content.lastIndexOf("## ", startIndex);
    const finalStartIndex = headerMatch !== -1 ? headerMatch : startIndex;

    return `\n# Previous context\n${content.slice(finalStartIndex)}\n\n`;
}
