"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api";
import {
    type ConfigResponse,
    type ProviderForm,
    type McpForm,
    type RegisteredAbility,
    emptyProvider,
    emptyMcp,
    fromResponse,
    toConfigShape,
} from "./settings/model";
import { DefaultProviderCard } from "./settings/DefaultProviderCard";
import { ProvidersCard } from "./settings/ProvidersCard";
import { AbilitiesCard } from "./settings/AbilitiesCard";
import { McpCard } from "./settings/McpCard";

/**
 * 设置页：全局配置 ~/.anycode/config.yaml 图形化编辑，热生效。
 * 卡片顺序：默认提供方 → 模型提供方 → 内置能力 → MCP 服务。
 * 数据在页面层统一持有，各卡片只收 props 渲染（见 settings/ 目录）。
 */
export default function SettingsPage() {
    const [providers, setProviders] = useState<ProviderForm[]>([]);
    const [def, setDef] = useState("");
    const [mcp, setMcp] = useState<McpForm[]>([]);
    const [status, setStatus] = useState<"loading" | "ready" | "error">(
        "loading"
    );
    const [saving, setSaving] = useState(false);
    // 单个 provider 表单折叠态（index → open；缺省展开）
    const [providerOpen, setProviderOpen] = useState<Record<number, boolean>>(
        {}
    );
    // 提交（Enter/blur）后的 provider 名：卡头标题 / 默认提供方下拉只读它——输入修改完毕才更新。
    // 输入中 p.name 是草稿态；提交时才同步到 nameCommitted。
    const [nameCommitted, setNameCommitted] = useState<Record<number, string>>(
        {}
    );
    // name 必填校验：空（或全空白）→ 红框 + 提示，且不提交
    const [nameError, setNameError] = useState<Record<number, boolean>>({});
    // 内置能力（SPEC-031 B-012）：注册器列表 + 开关态 + 原始 config（保存时保留 provider/apiKey 等）
    const [abilities, setAbilities] = useState<RegisteredAbility[]>([]);
    const [abilityOn, setAbilityOn] = useState<Record<string, boolean>>({});
    const [abilityCfg, setAbilityCfg] = useState<
        Record<string, Record<string, unknown>>
    >({});

    useEffect(() => {
        setStatus("loading");
        apiJson<ConfigResponse>(`/api/config`).then((res) => {
            if (res === null) {
                setStatus("error");
                return;
            }
            const { providers: ps, default: d, mcp: ms } = fromResponse(res);
            setProviders(ps);
            // 内置能力：注册器列表 + 开关初始化（config 显式 enabled 为准，缺省关）
            const reg = res.abilities?.registered ?? [];
            const cfgMap = res.abilities?.config ?? {};
            setAbilities(reg);
            setAbilityCfg(cfgMap);
            setAbilityOn(
                Object.fromEntries(
                    reg.map((a) => [a.name, cfgMap[a.name]?.enabled === true])
                )
            );
            setNameCommitted(
                Object.fromEntries(ps.map((p, i) => [i, p.name.trim()]))
            );
            setDef(d);
            setMcp(ms);
            setStatus("ready");
        });
    }, []);

    const patchProvider = (i: number, patch: Partial<ProviderForm>) =>
        setProviders((p) =>
            p.map((x, idx) => (idx === i ? { ...x, ...patch } : x))
        );
    const addProvider = () => setProviders((p) => [...p, emptyProvider()]);
    const removeProvider = (i: number) =>
        setProviders((p) => p.filter((_, idx) => idx !== i));

    /** 名称提交（Enter/blur）：trim 非空才生效——更新卡头标题 / 默认提供方下拉。
     *  空则红框 + 提示、不提交。重命名的是当前默认提供方 → def 跟随新名，避免指向不存在名字。 */
    const commitName = (i: number) => {
        const trimmed = providers[i].name.trim();
        setNameError((err) => {
            const next = { ...err };
            if (!trimmed) next[i] = true;
            else delete next[i];
            return next;
        });
        if (!trimmed) return;
        const old = nameCommitted[i];
        setNameCommitted((c) => ({ ...c, [i]: trimmed }));
        if (old && def === old) setDef(trimmed);
    };

    const patchMcp = (i: number, patch: Partial<McpForm>) =>
        setMcp((p) => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
    const addMcp = () => setMcp((p) => [...p, emptyMcp()]);
    const removeMcp = (i: number) =>
        setMcp((p) => p.filter((_, idx) => idx !== i));

    const patchAbilityCfg = (name: string, patch: Record<string, unknown>) =>
        setAbilityCfg((cfg) => ({
            ...cfg,
            [name]: { ...(cfg[name] ?? {}), ...patch },
        }));
    const toggleAbility = (name: string, v: boolean) =>
        setAbilityOn((on) => ({ ...on, [name]: v }));

    const save = async () => {
        setSaving(true);
        const body = toConfigShape(providers, def, mcp, abilityCfg, abilityOn);
        try {
            const res = await fetch(`/api/config`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                toast.success("已保存，下次对话生效");
            } else {
                let text = "保存失败";
                try {
                    const j = (await res.json()) as {
                        statusMessage?: string;
                    };
                    if (j.statusMessage) text = j.statusMessage;
                } catch {
                    // body 非 json，忽略
                }
                toast.error(text);
            }
        } catch {
            toast.error("网络错误，保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="w-full max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                        <h1 className="text-2xl font-bold text-foreground">
                            设置
                        </h1>
                        <span className="text-xs text-muted-foreground font-mono">
                            全局配置 ~/.anycode/config.yaml
                        </span>
                    </div>
                    <Button
                        className="shrink-0"
                        onClick={save}
                        disabled={saving || status !== "ready"}
                    >
                        {saving ? "保存中…" : "保存"}
                    </Button>
                </div>

                {status === "loading" && (
                    <p className="text-sm text-muted-foreground">加载配置中…</p>
                )}
                {status === "error" && (
                    <p className="text-sm text-destructive">
                        加载配置失败，请重试
                    </p>
                )}

                {status === "ready" && (
                    <>
                        <DefaultProviderCard
                            def={def}
                            providers={providers}
                            nameCommitted={nameCommitted}
                            onChange={setDef}
                        />
                        <ProvidersCard
                            providers={providers}
                            providerOpen={providerOpen}
                            setProviderOpen={setProviderOpen}
                            nameCommitted={nameCommitted}
                            nameError={nameError}
                            patchProvider={patchProvider}
                            commitName={commitName}
                            addProvider={addProvider}
                            removeProvider={removeProvider}
                        />
                        <AbilitiesCard
                            abilities={abilities}
                            abilityOn={abilityOn}
                            onToggle={toggleAbility}
                            abilityCfg={abilityCfg}
                            patchCfg={patchAbilityCfg}
                        />
                        <McpCard
                            mcp={mcp}
                            patchMcp={patchMcp}
                            addMcp={addMcp}
                            removeMcp={removeMcp}
                        />
                    </>
                )}
            </div>
        </div>
    );
}