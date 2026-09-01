import { statSync } from "node:fs";
import type { ToolContext } from "../../context";

/** 文件 staleness 追踪共享助手（edit/write 共用）。SPEC-022 B-005/B-006。 */

/** 当前 mtime（ms）；文件不存在返回 undefined。 */
export const mtimeOf = (p: string): number | undefined => {
    try {
        return statSync(p).mtimeMs;
    } catch {
        return undefined;
    }
};

/** staleness 检查：read/write 记过 mtime 且当前漂移 → 返回警告文案（不阻断）。 */
export function stalenessWarning(
    fileState: Map<string, number> | undefined,
    filePath: string,
    action: "编辑" | "覆写"
): string {
    if (!fileState) return "";
    const recorded = fileState.get(filePath);
    if (recorded === undefined) return "";
    const cur = mtimeOf(filePath);
    if (cur !== undefined && Math.abs(cur - recorded) > 1) {
        return ` [警告: 文件自上次 read 后被外部改动，已${action}]`;
    }
    return "";
}

/** 记录写入后的新 mtime（供后续 write/edit staleness 对比）。 */
export function recordMtime(
    fileState: Map<string, number> | undefined,
    filePath: string
): void {
    if (!fileState) return;
    const nm = mtimeOf(filePath);
    if (nm !== undefined) fileState.set(filePath, nm);
}
