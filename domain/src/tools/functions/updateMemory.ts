import type { ToolContext } from "../../context";
import { rewriteMemory, saveMemory, type MemoryScope } from "../../memory";

interface UpdateMemoryArgs {
    content: string;
    scope?: MemoryScope;
    /** 缺省 append（追加条目）；rewrite = 用 content 全量重写该层记忆（蒸馏整理）。 */
    mode?: "append" | "rewrite";
}

/**
 * update_memory 工具（FR-24 / SPEC-035）—— LLM 在 agentLoop 内主动调用，
 * 自主决定记什么、记到哪一层。rewrite 模式用于低频蒸馏：依据 system prompt
 * 已注入的当前记忆全量重写（合并冗余 / 剔除过时），无需先读文件。
 */
export const updateMemoryFunc = async (
    args: UpdateMemoryArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    const content = (args?.content ?? "").trim();
    if (!content) return "Error: content is required";
    const scope: MemoryScope = args?.scope === "global" ? "global" : "project";
    try {
        if (args?.mode === "rewrite") {
            rewriteMemory(workspace, content, scope);
            return `Rewrote ${scope} memory (${content.length} chars).`;
        }
        saveMemory(workspace, content, scope);
        return `Saved to ${scope} memory (${content.length} chars).`;
    } catch (error) {
        return `Error: ${
            error instanceof Error ? error.message : String(error)
        }`;
    }
};
