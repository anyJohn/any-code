"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppSelector } from "@/hooks/useRedux";
import { selectWorkspace } from "@/store/workspaceSlice";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import {
    periodTotals,
    stackedSeries,
    totalsByModel,
    type UsageRecord,
} from "@/lib/usageStats";

/** 模型单价（FR-22）：美元 / 每 1M tokens。 */
interface ModelPricing {
    input: number;
    output: number;
}

const fmt = (n: number | undefined | null) =>
    n == null ? "—" : n.toLocaleString();
const fmtCost = (n: number | null) => (n == null ? "—" : `$${n.toFixed(4)}`);

/**
 * 系列 槽位色（SPEC-042 面板升级）：dataviz 参考调色板 1-5 槽，双模式已过
 * validate_palette（light 的对比度 WARN 由"直接标签 + 表格视图"兜底）。
 * 颜色跟随实体（按全量总量降序固定指派，切换日/月不重排），第 6+ 折入 Other。
 */
const SERIES_CSS = `
.usage-viz { --sv1:#2a78d6; --sv2:#eb6834; --sv3:#1baf7a; --sv4:#eda100; --sv5:#e87ba4; --sv-other:#a1a1aa; }
.dark .usage-viz { --sv1:#3987e5; --sv2:#d95926; --sv3:#199e70; --sv4:#c98500; --sv5:#d55181; --sv-other:#71717a; }
`;
const SLOT_VARS = ["var(--sv1)", "var(--sv2)", "var(--sv3)", "var(--sv4)", "var(--sv5)"];

function rowCost(
    r: { model?: string; prompt_tokens: number; completion_tokens: number },
    pricing: Record<string, ModelPricing>
): number | null {
    const p = pricing[r.model ?? ""];
    if (!p) return null;
    return (
        (r.prompt_tokens / 1e6) * p.input +
        (r.completion_tokens / 1e6) * p.output
    );
}

/** 周期汇总 stat tile（headline number + 次行明细；文本用文本色，不穿系列色） */
function StatTile({ title, prompt, completion, cached, cost }: {
    title: string;
    prompt: number;
    completion: number;
    cached: number | null;
    cost: number | null;
}) {
    const total = prompt + completion;
    return (
        <div className="flex-1 min-w-0 rounded-lg border border-border px-3 py-2">
            <div className="text-[10px] text-muted-foreground truncate">{title}</div>
            <div className="text-lg font-semibold tabular-nums leading-tight">
                {total >= 1e6 ? `${(total / 1e6).toFixed(1)}M` : total >= 1e3 ? `${(total / 1e3).toFixed(1)}K` : total}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums truncate">
                ↑{fmt(prompt)} ↓{fmt(completion)}
                {cached != null && cached > 0 && ` · cache ${Math.round((cached / Math.max(1, prompt)) * 100)}%`}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
                {cost != null ? fmtCost(cost) : " "}
            </div>
        </div>
    );
}

/** 堆叠柱：div 实现（薄 mark / 4px 圆顶 / 段间 2px 表面缝 / hover tooltip） */
function StackChart({
    points,
    series,
    slotOf,
    pricing,
}: {
    points: {
        key: string;
        label: string;
        byModel: Record<string, { prompt: number; completion: number }>;
        prompt: number;
        completion: number;
    }[];
    series: string[];
    slotOf: (model: string) => number;
    pricing: Record<string, ModelPricing>;
}) {
    const { t } = useT();
    const [hover, setHover] = useState<number | null>(null);
    const max = Math.max(1, ...points.map((p) => p.prompt + p.completion));
    return (
        <div className="relative">
            <div className="flex items-end gap-px h-28" onMouseLeave={() => setHover(null)}>
                {points.map((p, i) => {
                    const total = p.prompt + p.completion;
                    const h = total === 0 ? 0 : Math.max(2, (total / max) * 100);
                    const models = series.filter((m) => p.byModel[m]);
                    return (
                        <div
                            key={p.key}
                            className="relative flex-1 flex flex-col justify-end self-stretch cursor-default"
                            onMouseEnter={() => setHover(i)}
                        >
                            <div
                                className="flex flex-col justify-end w-full transition-opacity"
                                style={{ height: `${h}%`, opacity: hover === null || hover === i ? 1 : 0.45 }}
                            >
                                {models.map((m, mi) => {
                                    const b = p.byModel[m];
                                    const seg = ((b.prompt + b.completion) / total) * 100;
                                    return (
                                        <div
                                            key={m}
                                            className="w-full first:rounded-t-[4px]"
                                            style={{
                                                height: `${seg}%`,
                                                backgroundColor:
                                                    slotOf(m) === -1 ? "var(--sv-other)" : SLOT_VARS[slotOf(m)],
                                                // 段间 2px 表面缝（mark spec）：非顶段上缘画表面色线
                                                boxShadow: mi > 0 ? "inset 0 2px 0 0 var(--card)" : undefined,
                                            }}
                                        />
                                    );
                                })}
                            </div>
                            {/* hover 目标大于 mark（整列命中区） */}
                            <div className="absolute inset-0" />
                        </div>
                    );
                })}
            </div>
            {/* x 轴：首/中/尾直接标签，其余省略（recessive） */}
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>{points[0]?.label}</span>
                <span>{points[Math.floor(points.length / 2)]?.label}</span>
                <span>{points[points.length - 1]?.label}</span>
            </div>
            {/* tooltip：hover 列的按模型分解 */}
            {hover !== null && points[hover] && (
                <div
                    className="absolute z-10 -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md pointer-events-none whitespace-nowrap"
                    role="status"
                >
                    <div className="font-medium mb-0.5">{points[hover].key}</div>
                    {series.filter((m) => points[hover]!.byModel[m]).map((m) => {
                        const b = points[hover]!.byModel[m];
                        const c = rowCost(
                            { model: m, prompt_tokens: b.prompt, completion_tokens: b.completion },
                            pricing
                        );
                        return (
                            <div key={m} className="flex items-center gap-1.5 text-muted-foreground">
                                <span
                                    className="inline-block size-2 rounded-sm shrink-0"
                                    style={{ backgroundColor: slotOf(m) === -1 ? "var(--sv-other)" : SLOT_VARS[slotOf(m)] }}
                                />
                                <span className="truncate max-w-28">{m}</span>
                                <span className="tabular-nums text-foreground">
                                    {fmt(b.prompt + b.completion)}
                                </span>
                                {c !== null && (
                                    <span className="tabular-nums">{fmtCost(c)}</span>
                                )}
                            </div>
                        );
                    })}
                    <div className="flex items-center gap-1.5 border-t border-border/50 mt-0.5 pt-0.5">
                        <span className="text-muted-foreground">{t("usagePanel.total")}</span>
                        <span className="tabular-nums">
                            {fmt(points[hover].prompt + points[hover].completion)}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * 全局用量总览页（/usage，SPEC-042 / 2026-09-16）：跨会话工作区统计——
 * 周期汇总（今日/本月/总计）→ 日/月堆叠柱图 → 按模型分布。
 * 数据源 = 工作区账本（usage.jsonl，跨会话）；当前会话逐轮消耗在 StatusBar 弹窗。
 * 入口：侧栏左下角直方图图标（与 /settings 同级页面）。
 */
export default function Usage() {
    const { t } = useT();
    const { selected } = useAppSelector(selectWorkspace);
    const projectKey = selected?.projectKey;
    const [pricing, setPricing] = useState<Record<string, ModelPricing>>({});
    const [records, setRecords] = useState<UsageRecord[] | null>(null);
    const [granularity, setGranularity] = useState<"day" | "month">("day");

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const cfg = await apiJson<{ pricing?: Record<string, ModelPricing> }>(
                "/api/config"
            );
            if (!cancelled && cfg) setPricing(cfg.pricing ?? {});
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!projectKey) return;
        let cancelled = false;
        void (async () => {
            const r = await apiJson<{ records: UsageRecord[] }>(
                `/api/workspaces/${projectKey}/usage`
            );
            if (!cancelled) setRecords(r?.records ?? []);
        })();
        return () => {
            cancelled = true;
        };
    }, [projectKey]);

    const hasPricing = Object.keys(pricing).length > 0;
    const totals = useMemo(() => periodTotals(records ?? []), [records]);
    const models = useMemo(() => totalsByModel(records ?? []), [records]);
    const { series, points } = useMemo(
        () =>
            stackedSeries(
                records ?? [],
                granularity,
                granularity === "day" ? 30 : 12,
                5
            ),
        [records, granularity]
    );
    const slotOf = useMemo(() => {
        const m = new Map(models.map((b, i) => [b.model, i < 5 ? i : -1]));
        return (model: string) => m.get(model) ?? -1;
    }, [models]);
    const maxModel = Math.max(1, ...models.map((b) => b.prompt + b.completion));
    const now = Date.now();
    const dayStart = new Date(now).setHours(0, 0, 0, 0);
    const monthStart = new Date(now).setDate(1);
    const costSince = (since: number): number | null => {
        if (!hasPricing) return null;
        let sum = 0;
        let any = false;
        for (const r of records ?? []) {
            if (r.ts < since) continue;
            const c = rowCost(r, pricing);
            if (c !== null) {
                any = true;
                sum += c;
            }
        }
        return any ? sum : null;
    };

    return (
        <div className="flex-1 min-h-0 overflow-y-auto">
            <style>{SERIES_CSS}</style>
            <div className="w-full max-w-3xl mx-auto px-4 py-4 usage-viz flex flex-col gap-5">
                <h1 className="text-sm font-medium">{t("usagePanel.workspaceTitle")}</h1>

                {records !== null && records.length === 0 && (
                    <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border px-3 py-2">
                        {t("usagePanel.ledgerEmpty")}
                    </p>
                )}

                {/* 周期汇总 stat tiles */}
                <div className="flex gap-2">
                    <StatTile
                        title={t("usagePanel.today")}
                        prompt={totals.today.prompt}
                        completion={totals.today.completion}
                        cached={totals.today.cached}
                        cost={costSince(dayStart)}
                    />
                    <StatTile
                        title={t("usagePanel.thisMonth")}
                        prompt={totals.month.prompt}
                        completion={totals.month.completion}
                        cached={totals.month.cached}
                        cost={costSince(monthStart)}
                    />
                    <StatTile
                        title={t("usagePanel.allTime")}
                        prompt={totals.total.prompt}
                        completion={totals.total.completion}
                        cached={totals.total.cached}
                        cost={costSince(0)}
                    />
                </div>

                {/* 日/月堆叠柱图 */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-medium text-muted-foreground">
                            {granularity === "day"
                                ? t("usagePanel.daily")
                                : t("usagePanel.monthly")}
                        </h4>
                        <div className="flex rounded-md border border-border text-[10px] overflow-hidden">
                            {(["day", "month"] as const).map((g) => (
                                <button
                                    key={g}
                                    className={`px-2 py-0.5 cursor-pointer ${granularity === g ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                    onClick={() => setGranularity(g)}
                                >
                                    {g === "day" ? t("usagePanel.byDay") : t("usagePanel.byMonth")}
                                </button>
                            ))}
                        </div>
                    </div>
                    <StackChart
                        points={points}
                        series={series}
                        slotOf={slotOf}
                        pricing={pricing}
                    />
                    {/* 图例（≥2 系列必配；文本用文本色） */}
                    {series.length >= 2 && (
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-muted-foreground">
                            {series.map((m) => (
                                <span key={m} className="inline-flex items-center gap-1 min-w-0">
                                    <span
                                        className="inline-block size-2 rounded-sm shrink-0"
                                        style={{ backgroundColor: SLOT_VARS[slotOf(m)] }}
                                    />
                                    <span className="truncate max-w-32" title={m}>{m}</span>
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* 按模型分布（横条 + 直接标签） */}
                {models.length > 0 && (
                    <div>
                        <h4 className="text-xs font-medium text-muted-foreground mb-1.5">
                            {t("usagePanel.byModel")}
                        </h4>
                        <div className="flex flex-col gap-1.5">
                            {models.map((b) => {
                                const total = b.prompt + b.completion;
                                const slot = slotOf(b.model);
                                const hit =
                                    b.cached != null && b.prompt > 0
                                        ? Math.round((b.cached / b.prompt) * 100)
                                        : null;
                                return (
                                    <div key={b.model} className="flex items-center gap-2 text-xs">
                                        <span className="truncate max-w-40 min-w-0" title={b.model}>
                                            {b.model}
                                        </span>
                                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                            <div
                                                className="h-full rounded-full"
                                                style={{
                                                    width: `${(total / maxModel) * 100}%`,
                                                    backgroundColor:
                                                        slot === -1 ? "var(--sv-other)" : SLOT_VARS[slot],
                                                }}
                                            />
                                        </div>
                                        <span className="tabular-nums text-muted-foreground shrink-0">
                                            {fmt(total)}
                                            {b.calls > 0 && ` · ${b.calls}${t("usagePanel.callsUnit")}`}
                                            {hit !== null && ` · cache ${hit}%`}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
