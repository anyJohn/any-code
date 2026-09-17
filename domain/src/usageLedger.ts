import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * 工作区用量账本（SPEC-042 B-003 / FR-22 延伸）：每条 durable Usage 事件一行原始
 * 记录（只增不改，I-001）。不存费用——费用在显示时点按当时 pricing 换算（DEC-149），
 * 单价修正后历史账单跟着修正。行级 JSONL，量级 ~150B/轮，无需轮转。
 * 文件：~/.anycode/projects/<projectKey>/usage.jsonl
 */

export interface UsageRecord {
    ts: number;
    sessionId: string;
    /** 产生该用量的 agent：主 agent 空 / sub-agent 名（DEC-152） */
    author?: string;
    model?: string;
    prompt_tokens: number;
    completion_tokens: number;
    /** SPEC-042 可选扩展：provider 未报则缺省（命中率有则显无则隐，DEC-151） */
    cached_tokens?: number;
    ttft_ms?: number;
    duration_ms?: number;
}

/** 账本文件路径（暴露供运维/调试；格式为内部实现细节） */
export function usageLedgerFile(projectKey: string): string {
    return path.join(
        os.homedir(),
        ".anycode",
        "projects",
        projectKey,
        "usage.jsonl"
    );
}

/** 追加一行用量记录。写失败由调用方兜底（C-002：审计类旁路不阻断对话）。 */
export async function appendUsageRecord(
    projectKey: string,
    record: UsageRecord
): Promise<void> {
    const file = usageLedgerFile(projectKey);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, JSON.stringify(record) + "\n", "utf-8");
}

/** 读全部账本行。损坏行跳过（appendFile 原子性有限，崩溃可能留半行）。
 *  注意：路径解析在 try 外——文件缺失（ENOENT）才吞，路径错误必须抛出。 */
export async function readUsageLedger(
    projectKey: string
): Promise<UsageRecord[]> {
    const file = usageLedgerFile(projectKey);
    let content: string;
    try {
        content = await fs.promises.readFile(file, "utf-8");
    } catch {
        return [];
    }
    const out: UsageRecord[] = [];
    for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
            const rec = JSON.parse(line) as UsageRecord;
            if (typeof rec.prompt_tokens === "number") out.push(rec);
        } catch {
            // 半行/坏行跳过
        }
    }
    return out;
}
