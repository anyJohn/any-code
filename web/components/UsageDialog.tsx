import { useEffect, useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import type { AgentEvent, UsageData } from "@/lib/sseEvents";

/** 模型单价（FR-22）：美元 / 每 1M tokens。 */
export interface ModelPricing {
    input: number;
    output: number;
}

const fmt = (n: number | undefined | null) =>
    n == null ? "—" : n.toLocaleString();
const fmtCost = (n: number | null) => (n == null ? "—" : `$${n.toFixed(4)}`);

/**
 * 系列 槽位色：dataviz 参考调色板 1 号槽（会话柱图单系列），双模式已过 validate_palette。
 * 必须经 <style> 注入组件树——缺这份 CSS，var(--sv1) 无效 = 柱体全透明（2026-09-16 bugfix）。
 */
const SERIES_CSS = `
.usage-viz { --sv1:#2a78d6; }
.dark .usage-viz { --sv1:#3987e5; }
`;

/** 单次调用的费用换算；无单价 → null（列隐藏，AC-006） */
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

/** 拉取 pricing（FR-22） */
function usePricing(open: boolean): Record<string, ModelPricing> {
    const [pricing, setPricing] = useState<Record<string, ModelPricing>>({});
    useEffect(() => {
        if (!open) return;
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
    }, [open]);
    return pricing;
}

/** 会话汇总 stat tile（headline number + 次行明细；文本用文本色） */
function StatTile({ title, prompt, completion, cached, cost, headline }: {
    title: string;
    prompt?: number;
    completion?: number;
    cached?: number | null;
    cost?: number | null;
    headline?: string;
}) {
    const total = (prompt ?? 0) + (completion ?? 0);
    return (
        <div className="flex-1 min-w-0 rounded-lg border border-border px-3 py-2">
            <div className="text-[10px] text-muted-foreground truncate">{title}</div>
            <div className="text-lg font-semibold tabular-nums leading-tight">
                {headline ??
                    (total >= 1e6
                        ? `${(total / 1e6).toFixed(1)}M`
                        : total >= 1e3
                          ? `${(total / 1e3).toFixed(1)}K`
                          : total)}
            </div>
            {prompt != null && (
                <div className="text-[10px] text-muted-foreground tabular-nums truncate">
                    ↑{fmt(prompt)} ↓{fmt(completion)}
                    {cached != null && cached > 0 &&
                        ` · cache ${Math.round((cached / Math.max(1, prompt)) * 100)}%`}
                </div>
            )}
            <div className="text-[10px] text-muted-foreground tabular-nums">
                {cost != null ? fmtCost(cost) : " "}
            </div>
        </div>
    );
}

/** 会话逐轮柱：div 实现（单一槽位色，hover tooltip 显模型/耗时/费用） */
function SessionBars({
    rows,
    pricing,
}: {
    rows: UsageData[];
    pricing: Record<string, ModelPricing>;
}) {
    const [hover, setHover] = useState<number | null>(null);
    const max = Math.max(1, ...rows.map((r) => r.prompt_tokens + r.completion_tokens));
    return (
        <div className="relative">
            <div className="flex items-end gap-px h-24" onMouseLeave={() => setHover(null)}>
                {rows.map((r, i) => {
                    const total = r.prompt_tokens + r.completion_tokens;
                    const h = Math.max(2, (total / max) * 100);
                    return (
                        <div
                            key={i}
                            className="relative flex-1 self-stretch flex flex-col justify-end cursor-default"
                            onMouseEnter={() => setHover(i)}
                        >
                            <div
                                className="w-full rounded-t-[4px] transition-opacity"
                                style={{
                                    height: `${h}%`,
                                    backgroundColor: "var(--sv1)",
                                    opacity: hover === null || hover === i ? 1 : 0.45,
                                }}
                            />
                        </div>
                    );
                })}
            </div>
            {hover !== null && rows[hover] && (
                <div
                    className="absolute z-10 -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md pointer-events-none whitespace-nowrap"
                    role="status"
                >
                    <div className="font-medium mb-0.5">
                        #{hover + 1} · <span className="text-muted-foreground">{rows[hover].model ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span>↑{fmt(rows[hover].prompt_tokens)} ↓{fmt(rows[hover].completion_tokens)}</span>
                    </div>
                    {rows[hover].ttft_ms != null && (
                        <div className="text-muted-foreground">
                            ttft {rows[hover].ttft_ms}ms
                            {rows[hover].duration_ms != null &&
                                ` · ${(rows[hover].duration_ms / 1000).toFixed(1)}s`}
                        </div>
                    )}
                    {(() => {
                        const c = rowCost(rows[hover], pricing);
                        return c !== null ? (
                            <div className="tabular-nums text-muted-foreground">{fmtCost(c)}</div>
                        ) : null;
                    })()}
                </div>
            )}
        </div>
    );
}

/** 会话逐轮明细表（AC-004 旧数据可读 + dataviz 表格视图兜底） */
function DetailTable({
    rows,
    pricing,
}: {
    rows: UsageData[];
    pricing: Record<string, ModelPricing>;
}) {
    const { t } = useT();
    const hasPricing = Object.keys(pricing).length > 0;
    return (
        <table className="w-full text-xs tabular-nums mt-2">
            <thead className="text-muted-foreground">
                <tr className="text-left">
                    <th className="py-1 font-normal">#</th>
                    <th className="py-1 font-normal">{t("usagePanel.model")}</th>
                    <th className="py-1 font-normal text-right">{t("usagePanel.input")}</th>
                    <th className="py-1 font-normal text-right">{t("usagePanel.output")}</th>
                    <th className="py-1 font-normal text-right">{t("usagePanel.cached")}</th>
                    <th className="py-1 font-normal text-right">{t("usagePanel.ttft")}</th>
                    <th className="py-1 font-normal text-right">{t("usagePanel.duration")}</th>
                    {hasPricing && (
                        <th className="py-1 font-normal text-right">{t("usagePanel.cost")}</th>
                    )}
                </tr>
            </thead>
            <tbody>
                {rows.map((d, i) => {
                    const c = hasPricing ? rowCost(d, pricing) : null;
                    return (
                        <tr key={i} className="border-t border-border/50">
                            <td className="py-1">{i + 1}</td>
                            <td className="py-1 truncate max-w-32" title={d.model}>
                                {d.model ?? "—"}
                            </td>
                            <td className="py-1 text-right">{fmt(d.prompt_tokens)}</td>
                            <td className="py-1 text-right">{fmt(d.completion_tokens)}</td>
                            <td className="py-1 text-right">{fmt(d.cached_tokens)}</td>
                            <td className="py-1 text-right">
                                {d.ttft_ms != null ? `${d.ttft_ms}ms` : "—"}
                            </td>
                            <td className="py-1 text-right">
                                {d.duration_ms != null
                                    ? `${(d.duration_ms / 1000).toFixed(1)}s`
                                    : "—"}
                            </td>
                            {hasPricing && (
                                <td className="py-1 text-right">{fmtCost(c)}</td>
                            )}
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

/**
 * 会话消耗弹窗（SPEC-042 / 2026-09-16 入口拆分）：当前会话的消耗——
 * 汇总 tiles + 逐轮柱图 + 明细表。数据源 = 当前会话 Usage 事件（会话口径）。
 * 全局跨会话总览在 /usage 页（侧栏直方图图标）。入口：StatusBar 累计 tokens 点击。
 */
export function SessionUsageDialog({
    open,
    onOpenChange,
    events,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    events: AgentEvent[];
}) {
    const { t } = useT();
    const pricing = usePricing(open);
    const [showDetail, setShowDetail] = useState(false);
    const rows = useMemo(
        () =>
            events
                .filter((e) => e.type === "Usage")
                .map((e) => e.data as UsageData),
        [events]
    );
    const total = rows.reduce(
        (acc, d) => {
            acc.prompt += d.prompt_tokens;
            acc.completion += d.completion_tokens;
            const c = rowCost(d, pricing);
            if (c !== null) acc.cost = (acc.cost ?? 0) + c;
            return acc;
        },
        { prompt: 0, completion: 0, cost: null as number | null }
    );
    const cached = rows.reduce((s, d) => s + (d.cached_tokens ?? 0), 0);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t("usagePanel.sessionTitle")}</DialogTitle>
                </DialogHeader>
                {/* 槽位色变量注入：缺这份 CSS 柱体 backgroundColor(var(--sv1)) 无效 = 全透明 */}
                <style>{SERIES_CSS}</style>
                <div className="usage-viz flex flex-col gap-3">
                    <div className="flex gap-2">
                        <StatTile
                            title={t("usagePanel.sessionSummary")}
                            prompt={total.prompt}
                            completion={total.completion}
                            cached={cached > 0 ? cached : null}
                            cost={total.cost}
                        />
                        <StatTile
                            title={t("usagePanel.calls")}
                            headline={String(rows.length)}
                        />
                    </div>
                    {rows.length > 0 ? (
                        <>
                            <h4 className="text-xs font-medium text-muted-foreground">
                                {t("usagePanel.sessionPerCall")}
                            </h4>
                            <SessionBars rows={rows} pricing={pricing} />
                            {/* 明细默认折叠（长会话表格过长，图表才是主体） */}
                            <button
                                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer text-left"
                                onClick={() => setShowDetail((v) => !v)}
                            >
                                {showDetail
                                    ? t("usagePanel.hideDetail")
                                    : t("usagePanel.showDetail")}
                            </button>
                            {showDetail && (
                                <DetailTable rows={rows} pricing={pricing} />
                            )}
                        </>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            {t("usagePanel.empty")}
                        </p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
