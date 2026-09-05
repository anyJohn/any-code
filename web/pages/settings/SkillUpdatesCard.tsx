"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import { CollapsibleCard } from "./CollapsibleCard";

/** 技能更新条目（FR-25 ③）：server GET /api/skills/updates。 */
interface SkillUpdate {
    name: string;
    installedVersion: string;
    builtinVersion: string;
    changes: string;
}

/** 技能更新卡：随包技能有新版本时列出（版本比对 + 变更说明），可选升级或跳过。 */
export function SkillUpdatesCard() {
    const { t } = useT();
    const [updates, setUpdates] = useState<SkillUpdate[] | null>(null);
    const [busy, setBusy] = useState("");

    const refresh = useCallback(async () => {
        const list = await apiJson<SkillUpdate[]>("/api/skills/updates");
        setUpdates(list ?? []);
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const act = async (name: string, action: "upgrade" | "skip") => {
        setBusy(name);
        try {
            await apiJson(`/api/skills/${action}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name }),
            });
        } catch {
            // 失败下次拉取自然恢复
        }
        await refresh();
        setBusy("");
    };

    return (
        <CollapsibleCard title={t("skillUpdates.title")}>
            {updates === null && (
                <p className="text-sm text-muted-foreground px-1">
                    {t("common.loading")}
                </p>
            )}
            {updates?.length === 0 && (
                <p className="text-sm text-muted-foreground px-1">
                    {t("skillUpdates.none")}
                </p>
            )}
            {updates?.map((u) => (
                <div key={u.name} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                        <span className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-sm font-medium text-foreground">
                                {u.name}
                                <span className="ml-2 text-xs font-mono text-muted-foreground">
                                    {u.installedVersion} → {u.builtinVersion}
                                </span>
                            </span>
                            {u.changes && (
                                <span className="text-xs text-muted-foreground whitespace-pre-wrap">
                                    {u.changes}
                                </span>
                            )}
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                            <Button
                                size="sm"
                                disabled={busy === u.name}
                                onClick={() => act(u.name, "upgrade")}
                            >
                                {t("skillUpdates.upgrade")}
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy === u.name}
                                onClick={() => act(u.name, "skip")}
                            >
                                {t("skillUpdates.skip")}
                            </Button>
                        </span>
                    </div>
                </div>
            ))}
        </CollapsibleCard>
    );
}
