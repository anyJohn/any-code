import type { ToolContext } from "../../context";
import { saveMemory, type MemoryScope } from "../../memory";

interface SaveMemoryArgs {
    content: string;
    scope?: MemoryScope;
}

/**
 * save_memory 工具 —— LLM 在 agentLoop 内主动调用，自主决定记什么、记到哪一层。
 * 取代过去每次任务结束无条件 saveMemory 的做法。
 */
export const saveMemoryFunc = async (
    args: SaveMemoryArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    const content = (args?.content ?? "").trim();
    if (!content) return "Error: content is required";
    const scope: MemoryScope = args?.scope === "global" ? "global" : "project";
    try {
        saveMemory(workspace, content, scope);
        return `Saved to ${scope} memory (${content.length} chars).`;
    } catch (error) {
        return `Error: ${
            error instanceof Error ? error.message : String(error)
        }`;
    }
};
