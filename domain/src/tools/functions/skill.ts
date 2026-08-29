import type { ToolContext } from "../../context";
import { ToolName } from "../../tools/toolName.enum";

/** skill 工具：按 name 返回技能全文（SPEC-031 B-005 / AC-006）。只读，不改文件。 */
export const skillFunc = async (
    args: { name?: string },
    ctx: ToolContext
): Promise<string> => {
    const name = args?.name?.trim();
    if (!name) return "Error: name 不能为空";
    const entry = ctx.skills?.get(name);
    if (!entry) {
        const available = ctx.skills ? [...ctx.skills.keys()].join(", ") : "";
        return `Error: 技能 "${name}" 不存在。可用技能：${available || "（无）"}`;
    }
    return `<skill_content>\n<name>${entry.name}</name>\n<origin>${entry.origin}</origin>\n${entry.content}\n</skill_content>`;
};