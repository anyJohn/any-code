"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from "@/components/ui/collapsible";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ProviderForm, ModelTestResult } from "./model";

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
    // 模型 拉取/测试 状态（Settings「拉取模型/测试模型/选择模型」）
    const [testResults, setTestResults] = useState<
        Record<string, ModelTestResult>
    >({});
    const [fetching, setFetching] = useState(false);
    const [testing, setTesting] = useState(false);
    // 拉取结果弹窗：fetchedModels 非 null 即弹；selectedIds 为勾选集
    const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    // 弹窗内：搜索过滤 + 测试结果（勾选后测选中未添加的，行内显 ✓/✗）
    const [search, setSearch] = useState("");
    const [dialogTestResults, setDialogTestResults] = useState<
        Record<string, ModelTestResult>
    >({});
    const [dialogTesting, setDialogTesting] = useState(false);

    /** 拉取 provider 模型列表，弹窗让用户勾选要加的（不直接并入）。 */
    const fetchModels = async () => {
        setFetching(true);
        try {
            const res = await fetch(`/api/config/models/fetch`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    baseURL: p.baseURL,
                    apiKey: p.apiKey,
                    // apiKey 表单留空=保留原值：传已提交名，server 用 config 已存 key
                    providerName: nameCommitted || p.name.trim(),
                }),
            });
            const j = (await res.json()) as {
                models?: string[];
                statusMessage?: string;
            };
            if (!res.ok) {
                toast.error(j.statusMessage ?? "拉取模型失败");
                return;
            }
            const ids = (j.models ?? []).filter(Boolean);
            if (!ids.length) {
                toast.error("模型列表为空（检查 baseURL 与 apiKey）");
                return;
            }
            setFetchedModels(ids);
            setSelectedIds(new Set(ids)); // 默认全选，用户取消勾选不要的
        } catch {
            toast.error("网络错误，拉取模型失败");
        } finally {
            setFetching(false);
        }
    };

    /** 弹窗确认：把勾选的模型并入 models（去重），空 defaultModel 设首个。 */
    const confirmAddModels = () => {
        if (!fetchedModels) return;
        const existing = new Set(
            p.models.map((m) => m.id.trim()).filter(Boolean)
        );
        const fresh = [...selectedIds].filter((id) => !existing.has(id));
        patchProvider(index, {
            models: [...p.models, ...fresh.map((id) => ({ id, name: "" }))],
        });
        if (!p.defaultModel.trim() && fresh.length) {
            patchProvider(index, { defaultModel: fresh[0] });
        }
        toast.success(`已添加 ${fresh.length} 个模型`);
        setFetchedModels(null);
    };

    /** 搜索过滤 + 工具函数（全选/全不选只作用于当前过滤结果里的未添加项）。 */
    const filteredIds = (fetchedModels ?? []).filter((id) =>
        id.toLowerCase().includes(search.trim().toLowerCase())
    );
    const notAddedOf = (ids: string[]) =>
        ids.filter(
            (id) => !p.models.some((m) => m.id.trim() === id)
        );
    const selectAll = () =>
        setSelectedIds((prev) => new Set([...prev, ...notAddedOf(filteredIds)]));
    const selectNone = () =>
        setSelectedIds(
            (prev) => new Set([...prev].filter((id) => !filteredIds.includes(id)))
        );
    /** 弹窗内测试：对勾选（未添加）的模型发 ping，结果行内显 ✓/✗。 */
    const testDialogSelected = async () => {
        const ids = notAddedOf([...selectedIds]);
        if (!ids.length) {
            toast.error("请先勾选要测试的模型");
            return;
        }
        setDialogTesting(true);
        setDialogTestResults({});
        try {
            const res = await fetch(`/api/config/models/test`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    baseURL: p.baseURL,
                    apiKey: p.apiKey,
                    providerName: nameCommitted || p.name.trim(),
                    models: ids,
                }),
            });
            const j = (await res.json()) as {
                results?: ModelTestResult[];
                statusMessage?: string;
            };
            if (!res.ok) {
                toast.error(j.statusMessage ?? "测试模型失败");
                return;
            }
            setDialogTestResults(
                Object.fromEntries(
                    (j.results ?? []).map((r) => [r.requested_model, r])
                )
            );
        } catch {
            toast.error("网络错误，测试模型失败");
        } finally {
            setDialogTesting(false);
        }
    };

    /** 测试当前 models 列表可用性 + 首字延迟。 */
    const testModels = async () => {
        const ids = p.models.map((m) => m.id.trim()).filter(Boolean);
        if (!ids.length) {
            toast.error("请先填写 model id 或拉取模型");
            return;
        }
        setTesting(true);
        setTestResults({});
        try {
            const res = await fetch(`/api/config/models/test`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    baseURL: p.baseURL,
                    apiKey: p.apiKey,
                    providerName: nameCommitted || p.name.trim(),
                    models: ids,
                }),
            });
            const j = (await res.json()) as {
                results?: ModelTestResult[];
                statusMessage?: string;
            };
            if (!res.ok) {
                toast.error(j.statusMessage ?? "测试模型失败");
                return;
            }
            setTestResults(
                Object.fromEntries(
                    (j.results ?? []).map((r) => [r.requested_model, r])
                )
            );
        } catch {
            toast.error("网络错误，测试模型失败");
        } finally {
            setTesting(false);
        }
    };

    return (
        <>
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
                                        if (e.key === "Enter")
                                            commitName(index);
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
                                                                      id: e
                                                                          .target
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
                                                                      name: e
                                                                          .target
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
                                        {(() => {
                                            const r = testResults[m.id.trim()];
                                            if (!r) return null;
                                            return r.available ? (
                                                <span
                                                    title={`首字 ${
                                                        r.first_token_latency_ms ??
                                                        "?"
                                                    }ms`}
                                                    className="text-[10px] shrink-0 text-emerald-600 dark:text-emerald-500"
                                                >
                                                    ✓
                                                    {r.first_token_latency_ms !=
                                                    null
                                                        ? ` ${r.first_token_latency_ms}ms`
                                                        : ""}
                                                </span>
                                            ) : (
                                                <span
                                                    title={r.error ?? "不可用"}
                                                    className="text-[10px] shrink-0 text-destructive"
                                                >
                                                    ✗
                                                </span>
                                            );
                                        })()}
                                    </div>
                                ))}
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-fit"
                                        onClick={fetchModels}
                                        disabled={fetching}
                                    >
                                        {fetching ? "拉取中…" : "拉取模型"}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-fit"
                                        onClick={testModels}
                                        disabled={testing || fetching}
                                    >
                                        {testing ? "测试中…" : "测试模型"}
                                    </Button>
                                    <span className="text-[10px] text-muted-foreground">
                                        测试通过可作默认模型
                                    </span>
                                </div>
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

            {/* 拉取结果弹窗：用户勾选要加入的模型 */}
            <Dialog
                open={fetchedModels !== null}
                onOpenChange={(v) => {
                    if (!v) setFetchedModels(null);
                }}
            >
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>选择要添加的模型</DialogTitle>
                    </DialogHeader>
                    {/* 工具栏：搜索过滤 + 全选/全不选（作用于当前过滤、未添加项） */}
                    <div className="flex items-center gap-2">
                        <Input
                            className="h-8 flex-1"
                            placeholder="搜索模型…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={selectAll}
                            disabled={filteredIds.length === 0}
                        >
                            全选
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={selectNone}
                            disabled={filteredIds.length === 0}
                        >
                            全不选
                        </Button>
                    </div>
                    {/* 可选表格：勾选 + 模型 + 测试状态 */}
                    <div className="max-h-72 overflow-y-auto border border-border rounded-md">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-background">
                                <tr className="border-b border-border">
                                    <th className="w-9 px-2 py-1.5 text-left font-medium text-muted-foreground">
                                        <input
                                            type="checkbox"
                                            className="size-3.5 accent-primary"
                                            checked={
                                                filteredIds.length > 0 &&
                                                filteredIds.every(
                                                    (id) =>
                                                        p.models.some(
                                                            (m) =>
                                                                m.id.trim() ===
                                                                id
                                                        ) ||
                                                        selectedIds.has(id)
                                                )
                                            }
                                            onChange={(e) =>
                                                e.target.checked
                                                    ? selectAll()
                                                    : selectNone()
                                            }
                                        />
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                                        模型
                                    </th>
                                    <th className="w-20 px-2 py-1.5 text-right font-medium text-muted-foreground">
                                        测试
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredIds.map((id) => {
                                    const added = p.models.some(
                                        (m) => m.id.trim() === id
                                    );
                                    const r = dialogTestResults[id];
                                    return (
                                        <tr
                                            key={id}
                                            className="border-b border-border/50 last:border-0 hover:bg-muted/40"
                                        >
                                            <td className="px-2 py-1">
                                                <input
                                                    type="checkbox"
                                                    className="size-3.5 accent-primary"
                                                    checked={
                                                        added ||
                                                        selectedIds.has(id)
                                                    }
                                                    disabled={added}
                                                    onChange={(e) =>
                                                        setSelectedIds(
                                                            (prev) => {
                                                                const next =
                                                                    new Set(
                                                                        prev
                                                                    );
                                                                if (
                                                                    e.target
                                                                        .checked
                                                                )
                                                                    next.add(id);
                                                                else
                                                                    next.delete(
                                                                        id
                                                                    );
                                                                return next;
                                                            }
                                                        )
                                                    }
                                                />
                                            </td>
                                            <td
                                                className={
                                                    "px-2 py-1 truncate max-w-64" +
                                                    (added
                                                        ? " text-muted-foreground line-through"
                                                        : "")
                                                }
                                            >
                                                {id}
                                                {added && "（已添加）"}
                                            </td>
                                            <td className="px-2 py-1 text-right">
                                                {r ? (
                                                    r.available ? (
                                                        <span
                                                            title={`首字 ${
                                                                r.first_token_latency_ms ??
                                                                "?"
                                                            }ms`}
                                                            className="text-[11px] text-emerald-600 dark:text-emerald-500"
                                                        >
                                                            ✓
                                                            {r.first_token_latency_ms !=
                                                            null
                                                                ? ` ${r.first_token_latency_ms}ms`
                                                                : ""}
                                                        </span>
                                                    ) : (
                                                        <span
                                                            title={
                                                                r.error ??
                                                                "不可用"
                                                            }
                                                            className="text-[11px] text-destructive"
                                                        >
                                                            ✗
                                                        </span>
                                                    )
                                                ) : null}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredIds.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={3}
                                            className="px-2 py-4 text-center text-xs text-muted-foreground"
                                        >
                                            无匹配模型
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => setFetchedModels(null)}
                        >
                            取消
                        </Button>
                        <Button
                            variant="outline"
                            onClick={testDialogSelected}
                            disabled={
                                notAddedOf([...selectedIds]).length === 0 ||
                                dialogTesting
                            }
                        >
                            {dialogTesting ? "测试中…" : "测试"}
                        </Button>
                        <Button
                            onClick={confirmAddModels}
                            disabled={selectedIds.size === 0}
                        >
                            添加 {selectedIds.size} 个
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
