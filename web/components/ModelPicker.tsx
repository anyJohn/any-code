"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";

/**
 * ModelPicker —— 输入框左下角的模型/Provider 切换 pill（用户需求 2026-09-04，
 * 取代 /model /provider 斜杠命令；布局参考 ChatGPT / LibreChat 的 composer 模型选择器）。
 * 弹层向上展开：provider 分组 + 模型列表，点模型 = 切 provider（跨 provider 时）+ 切模型，
 * 经 POST /api/commands/…（PATCH /api/config，domain switch 方法实现）。
 */

interface PickerModel {
    id: string;
    name?: string;
}
interface PickerState {
    providers: Record<string, { models: PickerModel[] }>;
    defaultProvider: string;
    currentModel: string;
    modelName: string;
}

export function ModelPicker({
    projectKey,
    disabled,
    onSwitched,
}: {
    projectKey?: string;
    disabled?: boolean;
    /** 切换成功后通知父级（StatusBar 刷新当前模型显示） */
    onSwitched: () => void;
}) {
    const { t } = useT();
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<PickerState | null>(null);
    const [switching, setSwitching] = useState(false);
    const [error, setError] = useState("");
    const rootRef = useRef<HTMLDivElement>(null);

    // 拉取 provider/model 清单与当前值（挂载即拉，pill 常显当前模型；打开时刷新）
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [status, cfg] = await Promise.all([
                projectKey
                    ? apiJson<{
                          provider: string;
                          model: string;
                          modelName: string;
                      }>(`/api/workspaces/${projectKey}/status`)
                    : Promise.resolve(null),
                apiJson<{
                    providers: Record<string, { models: PickerModel[] }>;
                    default: string;
                }>(`/api/config`),
            ]);
            if (cancelled) return;
            setState({
                providers: cfg?.providers ?? {},
                defaultProvider: cfg?.default ?? "",
                currentModel: status?.model ?? "",
                modelName: status?.modelName ?? "",
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [open, projectKey]);

    // 点击外部关闭
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener("mousedown", onDown);
        return () => window.removeEventListener("mousedown", onDown);
    }, [open]);

    const switchModel = async (providerName: string, modelId: string) => {
        setSwitching(true);
        setError("");
        try {
            const st = state!;
            // 跨 provider：先切 provider 再切模型（domain switch 方法逐段校验）
            if (providerName !== st.defaultProvider) {
                const rp = await fetch(`/api/config`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ default: providerName }),
                });
                if (!rp.ok) {
                    const j = (await rp.json().catch(() => ({}))) as {
                        statusMessage?: string;
                    };
                    setError(j.statusMessage ?? t("inputBox.switchFailed"));
                    return;
                }
            }
            const rm = await fetch(`/api/config`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ modelId }),
            });
            if (!rm.ok) {
                const j = (await rm.json().catch(() => ({}))) as {
                    statusMessage?: string;
                };
                setError(j.statusMessage ?? t("inputBox.switchFailed"));
                return;
            }
            setState((p) =>
                p
                    ? {
                          ...p,
                          defaultProvider: providerName,
                          currentModel: modelId,
                          modelName:
                              p.providers[providerName]?.models.find(
                                  (m) => m.id === modelId
                              )?.name ?? modelId,
                      }
                    : p
            );
            onSwitched();
        } finally {
            setSwitching(false);
        }
    };

    const label =
        state?.modelName ||
        state?.currentModel ||
        "…";

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                disabled={disabled}
                title={t("inputBox.modelPickerTitle")}
                className={cn(
                    "flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground",
                    "hover:bg-accent hover:text-foreground transition-colors",
                    "max-w-[16rem] min-w-0",
                    disabled && "opacity-50"
                )}
                onClick={() => setOpen((v) => !v)}
            >
                <span className="truncate font-mono">{label}</span>
                <ChevronUp className="size-3 shrink-0" />
            </button>
            {open && (
                <div className="absolute bottom-full left-0 mb-1 w-72 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover shadow-md z-20">
                    {switching && (
                        <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" />
                            {t("inputBox.modelPickerTitle")}…
                        </div>
                    )}
                    {error && (
                        <div className="px-3 py-1.5 text-xs text-destructive">
                            {error}
                        </div>
                    )}
                    {Object.entries(state?.providers ?? {}).map(
                        ([pname, p]) => (
                            <div key={pname}>
                                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 border-y border-border/60">
                                    <span className="text-[10px] font-mono uppercase text-muted-foreground">
                                        {pname}
                                        {pname === state?.defaultProvider && (
                                            <span className="ml-1 normal-case">
                                                {t("inputBox.currentProvider")}
                                            </span>
                                        )}
                                    </span>
                                    {pname !== state?.defaultProvider && (
                                        <button
                                            type="button"
                                            className="text-[10px] text-muted-foreground hover:text-foreground"
                                            onClick={() =>
                                                switchModel(
                                                    pname,
                                                    p.models[0]?.id ?? ""
                                                )
                                            }
                                        >
                                            {t("inputBox.useProvider")}
                                        </button>
                                    )}
                                </div>
                                {p.models.map((m) => {
                                    const isCurrent =
                                        pname === state?.defaultProvider &&
                                        m.id === state?.currentModel;
                                    return (
                                        <button
                                            key={`${pname}/${m.id}`}
                                            type="button"
                                            disabled={switching}
                                            className={cn(
                                                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm disabled:opacity-50",
                                                isCurrent
                                                    ? "bg-accent"
                                                    : "hover:bg-accent/50"
                                            )}
                                            onClick={() =>
                                                switchModel(pname, m.id)
                                            }
                                        >
                                            <span className="size-3 shrink-0 flex items-center justify-center">
                                                {isCurrent && (
                                                    <Check className="size-3 text-primary" />
                                                )}
                                            </span>
                                            <span className="truncate">
                                                {m.name || m.id}
                                            </span>
                                            {m.name && (
                                                <span className="ml-auto text-[10px] font-mono text-muted-foreground truncate">
                                                    {m.id}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )
                    )}
                    {state && Object.keys(state.providers).length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                            {t("inputBox.noModels")}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
