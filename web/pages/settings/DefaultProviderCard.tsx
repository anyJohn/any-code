"use client";

import { CollapsibleCard } from "./CollapsibleCard";

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
    return (
        <CollapsibleCard title="默认提供方">
            <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={def}
                onChange={(e) => onChange(e.target.value)}
            >
                {providers
                    .map((p, i) => (nameCommitted[i] ?? "").trim())
                    .filter(Boolean)
                    .map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
            </select>
        </CollapsibleCard>
    );
}