"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { CollapsibleCard } from "./CollapsibleCard";
import type { RegisteredAbility } from "./model";

/** web-search 的 provider 选项（与内置连接器 web-search-server.mjs 支持集一致）。 */
const SEARCH_PROVIDERS = ["ddg", "tavily", "bing"] as const;

/** browser-use 的 cdpUrl 默认值：browser 级 http 端点，连接器内部 /json/list 自动发现 page。 */
const DEFAULT_CDPURL = "http://127.0.0.1:9222";

function webConfig(cfg: Record<string, Record<string, unknown>>, name: string) {
    return (cfg[name] ?? {}) as Record<string, unknown>;
}

/** 内置能力卡片（SPEC-031 B-012）：注册器驱动，开关用 Switch，可开关不可删。
 *  web-search 行内提供 provider 下拉 + apiKey（写入 abilities.<name>.config）。 */
export function AbilitiesCard({
    abilities,
    abilityOn,
    onToggle,
    abilityCfg,
    patchCfg,
}: {
    abilities: RegisteredAbility[];
    abilityOn: Record<string, boolean>;
    onToggle: (name: string, v: boolean) => void;
    abilityCfg: Record<string, Record<string, unknown>>;
    patchCfg: (name: string, patch: Record<string, unknown>) => void;
}) {
    const { t } = useT();
    return (
        <CollapsibleCard title={t("abilitiesCard.title")}>
            {abilities.length === 0 && (
                <p className="text-sm text-muted-foreground px-1">
                    {t("abilitiesCard.empty")}
                </p>
            )}
            {abilities.map((a) => {
                const cfg = webConfig(abilityCfg, a.name);
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
                                    <span className="text-[10px] font-mono uppercase rounded bg-muted px-1 py-0.5 text-muted-foreground">
                                        {t("abilitiesCard.connector")}
                                    </span>
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {a.description}
                                </span>
                            </span>
                            <Switch
                                className="mt-0.5 shrink-0"
                                checked={abilityOn[a.name] ?? false}
                                onCheckedChange={(v) => onToggle(a.name, v)}
                                aria-label={t("abilitiesCard.enable", {
                                    name: a.name,
                                })}
                            />
                        </div>
                        {a.name === "web-search" && (
                            <div className="mt-3 pt-3 border-t border-border flex flex-col gap-2 sm:flex-row sm:items-end">
                                <label className="flex flex-col gap-1 flex-1">
                                    <span className="text-xs text-muted-foreground">
                                        {t("abilitiesCard.searchProvider")}
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
                                            ? t("abilitiesCard.apiKeyRequired")
                                            : t("abilitiesCard.apiKeyFree")}
                                    </span>
                                    <Input
                                        className="h-8 font-mono"
                                        type="password"
                                        placeholder={t(
                                            "abilitiesCard.apiKeyPlaceholder"
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
                        {a.name === "browser-use" && (
                            <div className="mt-3 pt-3 border-t border-border flex flex-col gap-1">
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">
                                        {t("abilitiesCard.cdpUrlLabel")}
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
                                    {t("abilitiesCard.cdpUrlHint", {
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
