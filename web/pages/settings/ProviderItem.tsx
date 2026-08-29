"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ProviderForm } from "./model";

/** 单个 provider：可折叠卡片（头部 = 已提交名称 + 默认模型 + 删除），体内是完整表单。
 *  名称提交（Enter/blur）后才同步标题/下拉框；空名红框拦截。 */
export function ProviderItem({
    p,
    index,
    open,
    onToggle,
    nameCommitted,
    nameError,
    patchProvider,
    commitName,
    removeProvider,
}: {
    p: ProviderForm;
    index: number;
    open: boolean;
    onToggle: (v: boolean) => void;
    nameCommitted: string;
    nameError: boolean;
    patchProvider: (i: number, patch: Partial<ProviderForm>) => void;
    commitName: (i: number) => void;
    removeProvider: (i: number) => void;
}) {
    return (
        <Collapsible open={open} onOpenChange={onToggle}>
            <div className="rounded-lg border border-border overflow-hidden">
                <CollapsibleTrigger asChild>
                    <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
                        <ChevronRight
                            className={cn(
                                "size-4 shrink-0 text-muted-foreground transition-transform",
                                open && "rotate-90"
                            )}
                        />
                        <span className="text-sm font-medium truncate">
                            {nameCommitted || "未命名提供方"}
                        </span>
                        {p.defaultModel && (
                            <span className="text-xs text-muted-foreground shrink-0">
                                默认 {p.defaultModel}
                            </span>
                        )}
                        <div className="flex-1" />
                        <span
                            className="shrink-0"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => removeProvider(index)}
                                title="删除"
                            >
                                <Trash2 className="size-3.5 text-muted-foreground" />
                            </Button>
                        </span>
                    </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="flex flex-col gap-2 px-3 pb-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">
                                名称
                            </span>
                            <Input
                                className={cn(
                                    "h-8 flex-1",
                                    nameError && "border-destructive"
                                )}
                                placeholder="名称（如 openai）"
                                value={p.name}
                                onChange={(e) =>
                                    patchProvider(index, {
                                        name: e.target.value,
                                    })
                                }
                                onBlur={() => commitName(index)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") commitName(index);
                                }}
                            />
                            {nameError && (
                                <span className="text-xs text-destructive">
                                    名称不能为空
                                </span>
                            )}
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">
                                Base URL（可选）支持 openai 格式 base url
                            </span>
                            <Input
                                className="h-8"
                                placeholder="https://.../v1"
                                value={p.baseURL}
                                onChange={(e) =>
                                    patchProvider(index, {
                                        baseURL: e.target.value,
                                    })
                                }
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">
                                API Key
                                {p.maskedKey &&
                                    ` （当前 ${p.maskedKey}，留空不改）`}
                            </span>
                            <Input
                                className="h-8 font-mono"
                                type="password"
                                placeholder="留空保留原值"
                                value={p.apiKey}
                                onChange={(e) =>
                                    patchProvider(index, {
                                        apiKey: e.target.value,
                                    })
                                }
                            />
                        </label>
                        <div className="grid grid-cols-1 gap-2">
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">
                                    上下文窗口（留空=自动探测）
                                </span>
                                <Input
                                    className="h-8 font-mono"
                                    type="number"
                                    placeholder="留空自动，或填上限（与探测取最小）"
                                    value={p.contextWindow}
                                    onChange={(e) =>
                                        patchProvider(index, {
                                            contextWindow: e.target.value,
                                        })
                                    }
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">
                                    最大输出 token（留空=自动）
                                </span>
                                <Input
                                    className="h-8 font-mono"
                                    type="number"
                                    placeholder="留空自动，或填上限（与探测取最小）"
                                    value={p.maxOutputTokens}
                                    onChange={(e) =>
                                        patchProvider(index, {
                                            maxOutputTokens: e.target.value,
                                        })
                                    }
                                />
                            </label>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs text-muted-foreground">
                                模型列表
                            </span>
                            {p.models.map((m, mi) => (
                                <div
                                    key={mi}
                                    className="flex items-center gap-2"
                                >
                                    <Input
                                        className="h-8 font-mono"
                                        placeholder="model id（如 gpt-4o）"
                                        value={m.id}
                                        onChange={(e) =>
                                            patchProvider(index, {
                                                models: p.models.map(
                                                    (x, xidx) =>
                                                        xidx === mi
                                                            ? {
                                                                  ...x,
                                                                  id: e.target
                                                                      .value,
                                                              }
                                                            : x
                                                ),
                                            })
                                        }
                                    />
                                    <Input
                                        className="h-8"
                                        placeholder="展示名（可选）"
                                        value={m.name}
                                        onChange={(e) =>
                                            patchProvider(index, {
                                                models: p.models.map(
                                                    (x, xidx) =>
                                                        xidx === mi
                                                            ? {
                                                                  ...x,
                                                                  name: e.target
                                                                      .value,
                                                              }
                                                            : x
                                                ),
                                            })
                                        }
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                        onClick={() =>
                                            patchProvider(index, {
                                                models: p.models.filter(
                                                    (_, xidx) => xidx !== mi
                                                ),
                                            })
                                        }
                                        title="删除模型"
                                    >
                                        <Trash2 className="size-3.5 text-muted-foreground" />
                                    </Button>
                                </div>
                            ))}
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-fit"
                                onClick={() =>
                                    patchProvider(index, {
                                        models: [
                                            ...p.models,
                                            { id: "", name: "" },
                                        ],
                                    })
                                }
                            >
                                <Plus className="size-3.5" /> 添加模型
                            </Button>
                        </div>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">
                                默认模型
                            </span>
                            <select
                                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                value={p.defaultModel}
                                onChange={(e) =>
                                    patchProvider(index, {
                                        defaultModel: e.target.value,
                                    })
                                }
                            >
                                {p.models
                                    .map((m) => m.id.trim())
                                    .filter(Boolean)
                                    .map((id) => (
                                        <option key={id} value={id}>
                                            {id}
                                        </option>
                                    ))}
                            </select>
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                className="size-3.5 accent-primary"
                                checked={p.streaming}
                                onChange={(e) =>
                                    patchProvider(index, {
                                        streaming: e.target.checked,
                                    })
                                }
                            />
                            <span className="text-xs text-muted-foreground">
                                流式输出
                            </span>
                        </label>
                    </div>
                </CollapsibleContent>
            </div>
        </Collapsible>
    );
}