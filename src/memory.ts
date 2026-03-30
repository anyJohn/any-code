/**
 * Todo List
 * - 基于RAG的向量记忆检索,扩充记忆容量
 * - 记忆检索工具, Agent 自己检索记忆
 * - 记忆压缩/记忆蒸馏,自动压缩旧记忆，丢弃细节和过时的信息，保留核心内容和重要事件
 * - 分层记忆，分层为 工作记忆 -> 短期记忆 -> 长期记忆,拥有不同的信息密度和保存时间
 */

import fs from "fs";
import path from "path";

const MEMORY_FILE = path.join(__dirname, "..", "memory.md");

/**
 * 保存记忆到 memory.md 文件
 * @param task 用户输入
 * @param result 执行结果
 */
export function saveMemory(task: string, result: string): void {
  const timestamp = new Date().toISOString();
  const entry = `## ${timestamp}\n\n**Task:** ${task}\n\n**Result:**\n${result}\n\n---\n\n`;

  if (fs.existsSync(MEMORY_FILE)) {
    fs.appendFileSync(MEMORY_FILE, entry, "utf-8");
  } else {
    fs.writeFileSync(MEMORY_FILE, "# Agent Memory\n\n" + entry, "utf-8");
  }
}

/**
 * 通过滑动窗口方式加载 memory.md 文件
 * @param windowSize 窗口大小（字符数），默认 1000
 * @returns 记忆内容字符串
 */
export function loadMemory(windowSize: number = 1000): string {
  if (!fs.existsSync(MEMORY_FILE)) {
    return "";
  }

  const content = fs.readFileSync(MEMORY_FILE, "utf-8");
  if (content.length <= windowSize) {
    return content;
  }

  // 从末尾截取指定大小的内容
  const startIndex = content.length - windowSize;
  // 尝试从最近的标题开始，避免截断中间的内容
  const headerMatch = content.lastIndexOf("## ", startIndex);
  const finalStartIndex = headerMatch !== -1 ? headerMatch : startIndex;

  return content.slice(finalStartIndex);
}
