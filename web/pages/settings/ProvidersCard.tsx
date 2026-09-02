"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { CollapsibleCard } from "./CollapsibleCard";
import { ProviderItem } from "./ProviderItem";
import type { ProviderForm } from "./model";

/** 模型提供方卡片：列表 + 添加；单项折叠态 / 可删 / 名称必填校验。 */
export function ProvidersCard({
    providers,
    providerOpen,
    setProviderOpen,
    nameCommitted,
    nameError,
    patchProvider,
    commitName,
    addProvider,
    removeProvider,
}: {
    providers: ProviderForm[];
    providerOpen: Record<number, boolean>;
    setProviderOpen: (v: Record<number, boolean>) => void;
    nameCommitted: Record<number, string>;
    nameError: Record<number, boolean>;
    patchProvider: (i: number, patch: Partial<ProviderForm>) => void;
    commitName: (i: number) => void;
    addProvider: () => void;
    removeProvider: (i: number) => void;
}) {
    const { t } = useT();
    return (
        <CollapsibleCard
            title={t("providersCard.title")}
            action={
                <Button variant="outline" size="sm" onClick={addProvider}>
                    <Plus className="size-3.5" /> {t("providersCard.add")}
                </Button>
            }
        >
            {providers.map((p, i) => (
                <ProviderItem
                    key={i}
                    p={p}
                    index={i}
                    open={providerOpen[i] ?? true}
                    onToggle={(v) =>
                        setProviderOpen({ ...providerOpen, [i]: v })
                    }
                    nameCommitted={nameCommitted[i] ?? ""}
                    nameError={!!nameError[i]}
                    patchProvider={patchProvider}
                    commitName={commitName}
                    removeProvider={removeProvider}
                />
            ))}
        </CollapsibleCard>
    );
}