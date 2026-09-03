"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import { fmtTokens } from "@/lib/format";
import { useT } from "@/i18n";
import type { AgentEvent, UsageData } from "@/lib/sseEvents";

interface StatusInfo {
    provider: string;
    model: string;
    modelName: string;
    contextWindow: number;
    skillCount: number;
    mcpCount: number;
}

/** 模型单价（FR-22）：美元 / 每 1M tokens，config.yaml pricing 段。 */
interface ModelPricing {
    input: number;
    output: number;
}

/**
 * StatusBar —— 聊天区底部状态条：模型 / 上下文用量 / 会话累计 tokens（+费用） / 技能数 / MCP 数。
 * 静态信息挂载时拉一次，上下文用量取最新 Usage 事件实时更新；
 * 会话累计 = 全部 Usage 事件求和（durable 入盘 + live，多轮/重进会话仍在）；
 * 费用仅在 config 配了 pricing 单价时显示（按事件模型戳逐条换算，无单价的事件跳过）。
 */
export function StatusBar({
    projectKey,
    events,
    pending,
}: {
    projectKey: string;
    events: AgentEvent[];
    /** run 进行中——pending 变化（run 开始/结束）时重拉 status，让 agent 改 config 后下条 run 反映 */
    pending: boolean;
}) {
    const { t } = useT();
    const [status, setStatus] = useState<StatusInfo>({
        provider: "",
        model: "",
        modelName: "",
        contextWindow: 128000,
        skillCount: 0,
        mcpCount: 0,
    });
    const [pricing, setPricing] = useState<Record<string, ModelPricing>>({});

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const data = await apiJson<
                StatusInfo & {
                    skillNames: string[];
                    mcpServers: { name: string; type: string }[];
                }
            >(`/api/workspaces/${projectKey}/status`);
            if (cancelled || !data) return;
            setStatus({
                provider: data.provider,
                model: data.model,
                modelName: data.modelName,
                contextWindow: data.contextWindow,
                skillCount: data.skillCount,
                mcpCount: data.mcpServers.length,
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [projectKey, pending]);

    // FR-22：单价表（config pricing 段）；未配则不显示费用
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const cfg = await apiJson<{ pricing?: Record<string, ModelPricing> }>(
                "/api/config"
            );
            if (cancelled || !cfg) return;
            setPricing(cfg.pricing ?? {});
        })();
        return () => {
            cancelled = true;
        };
    }, [pending]);

    // 最新 Usage 事件 → 实时 token 用量；全部 Usage 事件 → 会话累计 + 费用（FR-22）
    let promptTokens = 0;
    let ctxWindow = status.contextWindow;
    let totalPrompt = 0;
    let totalCompletion = 0;
    let cost: number | null = Object.keys(pricing).length > 0 ? 0 : null;
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.type !== "Usage") continue;
        const d = ev.data as UsageData;
        totalPrompt += d.prompt_tokens;
        totalCompletion += d.completion_tokens;
        if (cost !== null) {
            const p = pricing[d.model ?? status.model];
            if (p) {
                cost += (d.prompt_tokens / 1e6) * p.input + (d.completion_tokens / 1e6) * p.output;
            }
        }
    }
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.type === "Usage") {
            promptTokens = ev.data.prompt_tokens;
            ctxWindow = ev.data.contextWindow || status.contextWindow;
            break;
        }
    }
    const pct =
        ctxWindow > 0 ? Math.min(100, (promptTokens / ctxWindow) * 100) : 0;
    const labelName = status.modelName || status.model;
    const modelLabel = labelName
        ? status.provider
            ? `${status.provider}/${labelName}`
            : labelName
        : "—";

    return (
        <div className="shrink-0 border-t border-border px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-3 max-w-3xl mx-auto w-full">
            <span className="truncate font-mono">{modelLabel}</span>
            <div
                className="flex items-center gap-1.5 min-w-0"
                title={`${promptTokens} / ${ctxWindow}`}
            >
                <span className="tabular-nums shrink-0">
                    {promptTokens}/{ctxWindow}
                </span>
                <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden shrink-0">
                    <div
                        className={cn(
                            "h-full rounded-full transition-all",
                            pct > 80 ? "bg-amber-500" : "bg-primary/60"
                        )}
                        style={{ width: `${pct}%` }}
                    />
                </div>
            </div>
            {totalPrompt + totalCompletion > 0 && (
                <span
                    className="shrink-0 tabular-nums"
                    title={`${totalPrompt} + ${totalCompletion} tokens`}
                >
                    {t("statusBar.total", {
                        tokens: fmtTokens(totalPrompt + totalCompletion),
                    })}
                    {cost !== null && cost > 0 && ` · $${cost.toFixed(4)}`}
                </span>
            )}
            <span className="shrink-0">skill: {status.skillCount}</span>
            <span className="shrink-0">mcp: {status.mcpCount}</span>
        </div>
    );
}
