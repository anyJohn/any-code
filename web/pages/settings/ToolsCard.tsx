"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { CollapsibleCard } from "./CollapsibleCard";
import type { ToolCatalogItem } from "./model";

/** web_search 的 provider 选项（与原生工具 webSearchTool 支持集一致）。 */
const SEARCH_PROVIDERS = ["ddg", "tavily", "bing"] as const;

/** browser_use 的 cdpUrl 默认值：browser 级 http 端点，工具内部 /json/list 自动发现 page。 */
const DEFAULT_CDPURL = "http://127.0.0.1:9222";

function webConfig(cfg: Record<string, Record<string, unknown>>, name: string) {
    return (cfg[name] ?? {}) as Record<string, unknown>;
}

/** 通用工具开关卡（用户决策 2026-09-03，取代内置能力卡）：目录驱动，开关用 Switch。
 *  web_search 行内 provider 下拉 + apiKey；browser_use 行内 cdpUrl
 *  （写入 tools.<name>.config，出网代理走全局 config.proxy，不在工具层配）。 */
export function ToolsCard({
    tools,
    toolOn,
    onToggle,
    toolCfg,
    patchCfg,
}: {
    tools: ToolCatalogItem[];
    toolOn: Record<string, boolean>;
    onToggle: (name: string, v: boolean) => void;
    toolCfg: Record<string, Record<string, unknown>>;
    patchCfg: (name: string, patch: Record<string, unknown>) => void;
}) {
    const { t } = useT();
    return (
        <CollapsibleCard title={t("toolsCard.title")}>
            {tools.length === 0 && (
                <p className="text-sm text-muted-foreground px-1">
                    {t("toolsCard.empty")}
                </p>
            )}
            {tools.map((a) => {
                const cfg = webConfig(toolCfg, a.name);
                const isSearch = a.name === "web_search";
                const isBrowser = a.name === "browser_use";
                // 用户侧描述走 i18n（按工具名 key）；未覆盖的工具（扩展/MCP）兜底 LLM description
                const descKey = `toolsCard.desc.${a.name}`;
                const desc = t(descKey) === descKey ? a.description : t(descKey);
                return (
                    <div
                        key={a.name}
                        className="rounded-lg border border-border p-3"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <span className="flex flex-col gap-1 min-w-0">
                                <span className="flex items-center gap-1.5">
                                    <span className="text-sm font-medium text-foreground">
                                        {a.name}
                                    </span>
                                    {a.readOnly && (
                                        <span className="text-[10px] font-mono uppercase rounded bg-muted px-1 py-0.5 text-muted-foreground">
                                            {t("toolsCard.readOnly")}
                                        </span>
                                    )}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {desc}
                                </span>
                            </span>
                            <Switch
                                className="mt-0.5 shrink-0"
                                checked={toolOn[a.name] ?? true}
                                onCheckedChange={(v) => onToggle(a.name, v)}
                                aria-label={t("toolsCard.toggle", {
                                    name: a.name,
                                })}
                            />
                        </div>
                        {isSearch && (
                            <div className="mt-3 pt-3 border-t border-border flex flex-col gap-2 sm:flex-row sm:items-end">
                                <label className="flex flex-col gap-1 flex-1">
                                    <span className="text-xs text-muted-foreground">
                                        {t("toolsCard.searchProvider")}
                                    </span>
                                    <select
                                        className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        value={
                                            typeof cfg.provider === "string"
                                                ? cfg.provider
                                                : "ddg"
                                        }
                                        onChange={(e) =>
                                            patchCfg(a.name, {
                                                provider: e.target.value,
                                            })
                                        }
                                    >
                                        {SEARCH_PROVIDERS.map((p) => (
                                            <option key={p} value={p}>
                                                {p}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex flex-col gap-1 flex-1">
                                    <span className="text-xs text-muted-foreground">
                                        API Key
                                        {cfg.provider === "tavily" ||
                                        cfg.provider === "bing"
                                            ? t("toolsCard.apiKeyRequired")
                                            : t("toolsCard.apiKeyFree")}
                                    </span>
                                    <Input
                                        className="h-8 font-mono"
                                        type="password"
                                        placeholder={t(
                                            "toolsCard.apiKeyPlaceholder"
                                        )}
                                        value={
                                            typeof cfg.apiKey === "string"
                                                ? cfg.apiKey
                                                : ""
                                        }
                                        onChange={(e) =>
                                            patchCfg(a.name, {
                                                apiKey: e.target.value,
                                            })
                                        }
                                    />
                                </label>
                            </div>
                        )}
                        {isBrowser && (
                            <div className="mt-3 pt-3 border-t border-border flex flex-col gap-1">
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">
                                        {t("toolsCard.cdpUrlLabel")}
                                    </span>
                                    <Input
                                        className="h-8 font-mono"
                                        placeholder={DEFAULT_CDPURL}
                                        value={
                                            typeof cfg.cdpUrl === "string" &&
                                            cfg.cdpUrl
                                                ? cfg.cdpUrl
                                                : DEFAULT_CDPURL
                                        }
                                        onChange={(e) =>
                                            patchCfg(a.name, {
                                                cdpUrl: e.target.value,
                                            })
                                        }
                                    />
                                </label>
                                <span className="text-[10px] text-muted-foreground">
                                    {t("toolsCard.cdpUrlHint", {
                                        url: DEFAULT_CDPURL,
                                    })}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}
        </CollapsibleCard>
    );
}
