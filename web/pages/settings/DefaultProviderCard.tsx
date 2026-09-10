"use client";

import { useT } from "@/i18n";
import { CollapsibleCard } from "./CollapsibleCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** 默认提供方卡片：可选列表只认已提交（Enter/blur）的 provider 名，输入中的不算。 */
export function DefaultProviderCard({
    def,
    providers,
    nameCommitted,
    onChange,
}: {
    def: string;
    providers: { name: string }[];
    nameCommitted: Record<number, string>;
    onChange: (v: string) => void;
}) {
    const { t } = useT();
    return (
        <CollapsibleCard title={t("defaultProviderCard.title")}>
            <Select value={def} onValueChange={onChange}>
                <SelectTrigger className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {providers
                        .map((p, i) => (nameCommitted[i] ?? "").trim())
                        .filter(Boolean)
                        .map((name) => (
                            <SelectItem key={name} value={name}>
                                {name}
                            </SelectItem>
                        ))}
                </SelectContent>
            </Select>
        </CollapsibleCard>
    );
}