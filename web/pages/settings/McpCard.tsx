"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { CollapsibleCard } from "./CollapsibleCard";
import type { McpForm } from "./model";

/** MCP 服务卡片：stdio / sse 两种 server 的表单录入。 */
export function McpCard({
    mcp,
    patchMcp,
    addMcp,
    removeMcp,
}: {
    mcp: McpForm[];
    patchMcp: (i: number, patch: Partial<McpForm>) => void;
    addMcp: () => void;
    removeMcp: (i: number) => void;
}) {
    const { t } = useT();
    return (
        <CollapsibleCard
            title={t("mcpCard.title")}
            action={
                <Button variant="outline" size="sm" onClick={addMcp}>
                    <Plus className="size-3.5" /> {t("mcpCard.add")}
                </Button>
            }
        >
            {mcp.map((m, i) => (
                <div
                    key={i}
                    className="flex flex-col gap-2 rounded-lg border border-border p-3"
                >
                    <div className="flex items-center gap-2">
                        <Input
                            className="h-8 flex-1"
                            placeholder={t("mcpCard.namePlaceholder")}
                            value={m.name}
                            onChange={(e) =>
                                patchMcp(i, { name: e.target.value })
                            }
                        />
                        <select
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                            value={m.type}
                            onChange={(e) =>
                                patchMcp(i, {
                                    type: e.target.value as "stdio" | "sse",
                                })
                            }
                        >
                            <option value="stdio">stdio</option>
                            <option value="sse">sse</option>
                        </select>
                        <Switch
                            checked={m.enabled}
                            onCheckedChange={(v) => patchMcp(i, { enabled: v })}
                            aria-label={t("mcpCard.enableAria")}
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => removeMcp(i)}
                            title={t("common.delete")}
                        >
                            <Trash2 className="size-3.5 text-muted-foreground" />
                        </Button>
                    </div>
                    {m.type === "stdio" ? (
                        <>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">
                                    command
                                </span>
                                <Input
                                    className="h-8 font-mono"
                                    placeholder="npx"
                                    value={m.command}
                                    onChange={(e) =>
                                        patchMcp(i, {
                                            command: e.target.value,
                                        })
                                    }
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">
                                    {t("mcpCard.argsLabel")}
                                </span>
                                <textarea
                                    className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    rows={3}
                                    placeholder={
                                        "-y\n@modelcontextprotocol/server-filesystem"
                                    }
                                    value={m.args}
                                    onChange={(e) =>
                                        patchMcp(i, { args: e.target.value })
                                    }
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">
                                    {t("mcpCard.envLabel")}
                                </span>
                                <textarea
                                    className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    rows={3}
                                    placeholder={"FOO=bar"}
                                    value={m.env}
                                    onChange={(e) =>
                                        patchMcp(i, { env: e.target.value })
                                    }
                                />
                            </label>
                        </>
                    ) : (
                        <>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">
                                    url
                                </span>
                                <Input
                                    className="h-8 font-mono"
                                    placeholder="https://..."
                                    value={m.url}
                                    onChange={(e) =>
                                        patchMcp(i, { url: e.target.value })
                                    }
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">
                                    {t("mcpCard.headersLabel")}
                                </span>
                                <textarea
                                    className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    rows={3}
                                    placeholder={"Authorization:Bearer xxx"}
                                    value={m.headers}
                                    onChange={(e) =>
                                        patchMcp(i, {
                                            headers: e.target.value,
                                        })
                                    }
                                />
                            </label>
                        </>
                    )}
                </div>
            ))}
            {mcp.length === 0 && (
                <p className="text-sm text-muted-foreground px-1">
                    {t("mcpCard.empty")}
                </p>
            )}
        </CollapsibleCard>
    );
}
