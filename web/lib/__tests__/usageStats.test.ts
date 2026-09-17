import { describe, expect, it } from "vitest";
import {
    bucketKeys,
    periodTotals,
    stackedSeries,
    totalsByModel,
    type UsageRecord,
} from "../usageStats";

/** SPEC-042 面板升级：统计聚合纯函数。 */

// 固定"现在"：2026-09-16 12:00 本地
const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime();
const rec = (o: Partial<UsageRecord>): UsageRecord => ({
    ts: NOW,
    sessionId: "s",
    prompt_tokens: 0,
    completion_tokens: 0,
    ...o,
});

describe("bucketKeys", () => {
    it("日桶：含今日往前 N 天，空洞补齐", () => {
        const keys = bucketKeys("day", 3, NOW);
        expect(keys).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);
    });
    it("月桶：跨年正确", () => {
        const now = new Date(2026, 0, 15).getTime();
        expect(bucketKeys("month", 3, now)).toEqual([
            "2025-11",
            "2025-12",
            "2026-01",
        ]);
    });
});

describe("totalsByModel", () => {
    it("按总量降序；cached 有则聚合并，无则 null", () => {
        const rows = [
            rec({ model: "a", prompt_tokens: 100, completion_tokens: 10, cached_tokens: 60 }),
            rec({ model: "b", prompt_tokens: 300, completion_tokens: 5 }),
            rec({ model: "a", prompt_tokens: 10, completion_tokens: 1 }),
        ];
        const t = totalsByModel(rows);
        expect(t.map((x) => x.model)).toEqual(["b", "a"]);
        expect(t[1]).toMatchObject({
            model: "a",
            calls: 2,
            prompt: 110,
            completion: 11,
            cached: 60,
        });
        expect(t[0].cached).toBeNull();
    });
});

describe("stackedSeries", () => {
    const rows: UsageRecord[] = [
        rec({ ts: NOW, model: "m1", prompt_tokens: 100, completion_tokens: 10 }),
        rec({ ts: NOW - 86400e3, model: "m2", prompt_tokens: 50, completion_tokens: 5 }),
        // 窗口外（40 天前）——不进 30 天日序列
        rec({ ts: NOW - 40 * 86400e3, model: "m3", prompt_tokens: 999, completion_tokens: 0 }),
    ];
    it("落入正确的日桶；窗口外记录不计入", () => {
        const { series, points } = stackedSeries(rows, "day", 3, 5, NOW);
        expect(series).toEqual(["m1", "m2"]);
        expect(points[2].byModel["m1"]).toEqual({ prompt: 100, completion: 10 });
        expect(points[1].byModel["m2"]).toEqual({ prompt: 50, completion: 5 });
        expect(points[0].prompt).toBe(0); // 空洞补零
        expect(points[2].prompt).toBe(100); // m3 窗口外不计
    });
    it("series 超过 maxSeries 折叠（第 6 个模型不入序列）", () => {
        const many: UsageRecord[] = ["a", "b", "c", "d", "e", "f"].map((m, i) =>
            rec({ ts: NOW, model: m, prompt_tokens: 100 - i, completion_tokens: 1 })
        );
        const { series } = stackedSeries(many, "day", 1, 5, NOW);
        expect(series).toHaveLength(5);
        expect(series).not.toContain("f");
    });
});

describe("periodTotals", () => {
    it("今日/本月/总计三口径", () => {
        const rows = [
            rec({ ts: NOW, prompt_tokens: 10, completion_tokens: 1, cached_tokens: 8 }),
            rec({ ts: NOW - 86400e3, prompt_tokens: 20, completion_tokens: 2 }), // 昨日（本月内）
            rec({ ts: NOW - 40 * 86400e3, prompt_tokens: 40, completion_tokens: 4 }), // 上月
        ];
        const t = periodTotals(rows, NOW);
        expect(t.today).toMatchObject({ prompt: 10, completion: 1, cached: 8 });
        expect(t.month).toMatchObject({ prompt: 30, completion: 3, cached: 8 });
        expect(t.total).toMatchObject({ prompt: 70, completion: 7, cached: 8 });
    });
});
