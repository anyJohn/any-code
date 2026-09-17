import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    appendUsageRecord,
    readUsageLedger,
    usageLedgerFile,
} from "../src/usageLedger";

/** SPEC-042 B-003：工作区用量账本——只增不改（I-001）、坏行跳过、可选字段透传。 */

// os.homedir() 注入：账本路径基于 HOME，测试前改环境
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-ledger-"));
const realHome = process.env.HOME;
process.env.HOME = tmp;
afterAll(() => {
    process.env.HOME = realHome;
    fs.rmSync(tmp, { recursive: true, force: true });
});

const PK = "test-project";

describe("用量账本（SPEC-042）", () => {
    it("空账本读出空数组（无文件不报错）", async () => {
        expect(await readUsageLedger(PK)).toEqual([]);
    });

    it("追加后可读回；只增不改（I-001）", async () => {
        await appendUsageRecord(PK, {
            ts: 1,
            sessionId: "s1",
            model: "m1",
            prompt_tokens: 100,
            completion_tokens: 10,
        });
        await appendUsageRecord(PK, {
            ts: 2,
            sessionId: "s1",
            author: "plan",
            model: "m1",
            prompt_tokens: 50,
            completion_tokens: 5,
            cached_tokens: 40,
            ttft_ms: 120,
            duration_ms: 900,
        });
        const rows = await readUsageLedger(PK);
        expect(rows).toHaveLength(2);
        expect(rows[1].author).toBe("plan");
        expect(rows[1].cached_tokens).toBe(40);
        expect(rows[1].ttft_ms).toBe(120);
        // 追加语义：首行原样保留
        expect(rows[0].prompt_tokens).toBe(100);
    });

    it("坏行/半行跳过不炸（崩溃原子性兜底）", async () => {
        const file = usageLedgerFile(PK);
        fs.appendFileSync(file, '{"ts":3,"prompt_tok'); // 半行
        fs.appendFileSync(file, "\n" + JSON.stringify({ ts: 4, sessionId: "s2", prompt_tokens: 7, completion_tokens: 1 }) + "\n");
        const rows = await readUsageLedger(PK);
        expect(rows.filter((r) => r.ts === 4)).toHaveLength(1);
    });
});
