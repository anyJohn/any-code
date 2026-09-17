/** 用量统计聚合（SPEC-042 面板升级）：纯函数，账本行 → 日/月序列与周期汇总。
 *  费用不在聚合层换算——按显示时点 pricing 在组件层算（DEC-149）。 */

/** 账本行（镜像 domain UsageRecord，server /usage 返回） */
export interface UsageRecord {
    ts: number;
    sessionId: string;
    author?: string;
    model?: string;
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens?: number;
    ttft_ms?: number;
    duration_ms?: number;
}

export interface ModelBucket {
    model: string;
    calls: number;
    prompt: number;
    completion: number;
    cached: number | null; // null = 该桶内无任何 cached 数据（有则显无则隐）
}

export interface PeriodPoint {
    /** 桶 key：日 "YYYY-MM-DD" / 月 "YYYY-MM" */
    key: string;
    label: string;
    /** 按模型分解（与 series 顺序一致），series 之外的模型不计入 */
    byModel: Record<string, { prompt: number; completion: number }>;
    prompt: number;
    completion: number;
}

/** 本地时区的日桶 key（账本 ts 为 UTC 毫秒；用量归属按用户当地日历直觉） */
function dayKey(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function monthKey(ts: number): string {
    return dayKey(ts).slice(0, 7);
}

/** 序列桶骨架：今日起往前 days 个日桶 / 本月起往前 months 个月桶（空洞补零，序列不断轴） */
export function bucketKeys(granularity: "day" | "month", count: number, now = Date.now()): string[] {
    const keys: string[] = [];
    const d = new Date(now);
    if (granularity === "day") {
        for (let i = count - 1; i >= 0; i--) {
            const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
            keys.push(dayKey(t.getTime()));
        }
    } else {
        for (let i = count - 1; i >= 0; i--) {
            const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
            keys.push(monthKey(t.getTime()));
        }
    }
    return keys;
}

function emptyPoint(key: string, label: string): PeriodPoint {
    return { key, label, byModel: {}, prompt: 0, completion: 0 };
}

/** 记录落入桶（仅统计 series 内的模型；其他模型不丢——进 totals 兜底） */
function fill(
    points: PeriodPoint[],
    keyOf: (ts: number) => string,
    records: UsageRecord[],
    series: string[]
): void {
    const inSeries = new Set(series);
    for (const r of records) {
        const key = keyOf(r.ts);
        const p = points.find((x) => x.key === key);
        if (!p) continue;
        p.prompt += r.prompt_tokens;
        p.completion += r.completion_tokens;
        if (inSeries.has(r.model ?? "—")) {
            const b = (p.byModel[r.model ?? "—"] ??= {
                prompt: 0,
                completion: 0,
            });
            b.prompt += r.prompt_tokens;
            b.completion += r.completion_tokens;
        }
    }
}

/** 全量按模型分桶（面板"按模型分布"与 series 选取依据；总量降序） */
export function totalsByModel(records: UsageRecord[]): ModelBucket[] {
    const m = new Map<string, ModelBucket>();
    for (const r of records) {
        const k = r.model ?? "—";
        const b = m.get(k) ?? {
            model: k,
            calls: 0,
            prompt: 0,
            completion: 0,
            cached: null,
        };
        b.calls += 1;
        b.prompt += r.prompt_tokens;
        b.completion += r.completion_tokens;
        if (r.cached_tokens != null) {
            b.cached = (b.cached ?? 0) + r.cached_tokens;
        }
        m.set(k, b);
    }
    return [...m.values()].sort(
        (a, b) => b.prompt + b.completion - (a.prompt + a.completion)
    );
}

/** 日/月堆叠序列（按总量降序取前 n 个模型，其余折入不计——统计口径见 panel 注） */
export function stackedSeries(
    records: UsageRecord[],
    granularity: "day" | "month",
    count: number,
    maxSeries = 5,
    now = Date.now()
): { keys: string[]; series: string[]; points: PeriodPoint[] } {
    const keys = bucketKeys(granularity, count, now);
    const points = keys.map((key) =>
        emptyPoint(
            key,
            granularity === "day"
                ? key.slice(5).replace("-", "/")
                : key.replace("-", "/")
        )
    );
    // series 选取：统计窗口内的总量降序（颜色跟随实体——同面板内两种粒度共用同一映射）
    const windowMs =
        granularity === "day"
            ? count * 24 * 3600 * 1000
            : count * 31 * 24 * 3600 * 1000;
    const cutoff = now - windowMs;
    const inWindow = records.filter((r) => r.ts >= cutoff);
    const series = totalsByModel(inWindow)
        .slice(0, maxSeries)
        .map((b) => b.model);
    fill(points, granularity === "day" ? dayKey : monthKey, inWindow, series);
    return { keys, series, points };
}

/** 周期汇总：今日 / 本月 / 总计（tokens 与缓存命中） */
export function periodTotals(records: UsageRecord[], now = Date.now()): {
    today: { prompt: number; completion: number; cached: number | null };
    month: { prompt: number; completion: number; cached: number | null };
    total: { prompt: number; completion: number; cached: number | null };
} {
    const empty = () => ({ prompt: 0, completion: 0, cached: null as number | null });
    const out = { today: empty(), month: empty(), total: empty() };
    const dk = dayKey(now);
    const mk = monthKey(now);
    for (const r of records) {
        out.total.prompt += r.prompt_tokens;
        out.total.completion += r.completion_tokens;
        if (r.cached_tokens != null)
            out.total.cached = (out.total.cached ?? 0) + r.cached_tokens;
        if (dayKey(r.ts) === dk) {
            out.today.prompt += r.prompt_tokens;
            out.today.completion += r.completion_tokens;
            if (r.cached_tokens != null)
                out.today.cached = (out.today.cached ?? 0) + r.cached_tokens;
        }
        if (monthKey(r.ts) === mk) {
            out.month.prompt += r.prompt_tokens;
            out.month.completion += r.completion_tokens;
            if (r.cached_tokens != null)
                out.month.cached = (out.month.cached ?? 0) + r.cached_tokens;
        }
    }
    return out;
}
