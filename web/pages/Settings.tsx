"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api";
import {
    type ConfigResponse,
    type ProviderForm,
    type McpForm,
    type ToolCatalogItem,
    type PermissionRuleForm,
    emptyProvider,
    emptyMcp,
    fromResponse,
    toConfigShape,
} from "./settings/model";
import { DefaultProviderCard } from "./settings/DefaultProviderCard";
import { ProvidersCard } from "./settings/ProvidersCard";
import { ToolsCard } from "./settings/ToolsCard";
import { McpCard } from "./settings/McpCard";
import { PermissionsCard } from "./settings/PermissionsCard";
import { YamlEditorModal } from "@/components/YamlEditorModal";
import { cn } from "@/lib/utils";

/**
 * 设置页：全局配置 ~/.anycode/config.yaml 图形化编辑，热生效。
 * 三 tab（RR 设置优化 2026-09-06）：模型 | 工具与权限 | 集成。
 * 自动保存：配置态变化防抖 800ms 静默保存（校验失败/加载中跳过，失败 toast）；
 * 右上角"编辑 config.yaml"弹窗支持高亮编辑原文。
 * 数据在页面层统一持有，各卡片只收 props 渲染（见 settings/ 目录）。
 */
type SettingsTab = "models" | "tools" | "integrations";
export default function SettingsPage() {
    const { t } = useT();
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
    // 通用工具目录（用户决策 2026-09-03）：全量工具 + 开关态 + 原始 config（保存时保留 provider/apiKey/cdpUrl 等）
    const [tools, setTools] = useState<ToolCatalogItem[]>([]);
    const [toolOn, setToolOn] = useState<Record<string, boolean>>({});
    const [toolCfg, setToolCfg] = useState<Record<string, Record<string, unknown>>>({});
    // 工具权限（SPEC-032）：模式 + 全局规则 + 危险命令基线
    const [permMode, setPermMode] = useState<"standard" | "accept_edits" | "trusted">("standard");
    const [permRules, setPermRules] = useState<PermissionRuleForm[]>([]);
    const [permDanger, setPermDanger] = useState<string[]>([]);
    const [tab, setTab] = useState<SettingsTab>("models");
    const [yamlOpen, setYamlOpen] = useState(false);

    const reloadConfig = () => setLoadTick((k) => k + 1);
    const [loadTick, setLoadTick] = useState(0);

    useEffect(() => {
        setStatus("loading");
        apiJson<ConfigResponse>(`/api/config`).then((res) => {
            if (res === null) {
                setStatus("error");
                return;
            }
            const { providers: ps, default: d, mcp: ms } = fromResponse(res);
            setProviders(ps);
            // 通用工具：目录 + 开关初始化（enabled=false 才关；未配置 = 启用）
            const reg = res.tools?.catalog ?? [];
            const cfgMap = res.tools?.config ?? {};
            setTools(reg);
            setToolCfg(cfgMap);
            setToolOn(Object.fromEntries(reg.map((x) => [x.name, x.enabled])));
            setNameCommitted(
                Object.fromEntries(ps.map((p, i) => [i, p.name.trim()]))
            );
            setDef(d);
            setMcp(ms);
            const perm = res.permissions;
            if (perm) {
                setPermMode(perm.mode ?? "standard");
                setPermRules(
                    (perm.rules ?? []).map((r) => ({
                        tool: r.tool,
                        pattern: r.pattern ?? "",
                        action: r.action,
                    }))
                );
                setPermDanger(perm.dangerPatterns ?? []);
            }
            setStatus("ready");
        });
    }, [loadTick]);

    // 自动保存（RR 设置优化）：配置态变化防抖 800ms 静默保存。
    // 加载后首跳过（loadTick 触发的重载由 dirtyRef 门禁）；名称校验失败/加载中不存。
    const dirtyRef = useRef(false);
    const loadedTickRef = useRef(0);
    useEffect(() => {
        if (status !== "ready") {
            loadedTickRef.current = loadTick;
            return;
        }
        if (loadedTickRef.current !== loadTick) {
            loadedTickRef.current = loadTick;
            return;
        }
        if (Object.values(nameError).some(Boolean)) return;
        if (!dirtyRef.current) {
            dirtyRef.current = true; // ready 后的首次运行不算 dirty
            return;
        }
        const timer = setTimeout(() => void save(true), 800);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [providers, def, mcp, toolCfg, toolOn, permMode, permRules, permDanger, status, loadTick]);

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

    const patchToolCfg = (name: string, patch: Record<string, unknown>) =>
        setToolCfg((cfg) => ({
            ...cfg,
            [name]: { ...(cfg[name] ?? {}), ...patch },
        }));
    const toggleTool = (name: string, v: boolean) =>
        setToolOn((on) => ({ ...on, [name]: v }));

    const save = async (silent = false) => {
        setSaving(true);
        const body = toConfigShape(providers, def, mcp, toolCfg, toolOn, {
            mode: permMode,
            rules: permRules,
            dangerPatterns: permDanger,
        });
        try {
            const res = await fetch(`/api/config`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                if (!silent) toast.success(t("settings.savedNextConversation"));
            } else {
                let text = t("settings.saveFailed");
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
            toast.error(t("settings.networkSaveFailed"));
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
                            {t("settings.title")}
                        </h1>
                        <span className="text-xs text-muted-foreground font-mono">
                            {t("settings.subtitle")}
                        </span>
                    </div>
                    {/* 自动保存（防抖 800ms）——无手动保存按钮；YAML 编辑为显式确认流 */}
                    <Button
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setYamlOpen(true)}
                    >
                        {t("settings.editYaml")}
                    </Button>
                </div>

                <div className="flex items-center gap-1">
                    {(
                        [
                            ["models", t("settings.tabModels")],
                            ["tools", t("settings.tabTools")],
                            ["integrations", t("settings.tabIntegrations")],
                        ] as const
                    ).map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={cn(
                                "inline-flex items-center rounded-md px-2.5 py-1 text-xs transition-colors",
                                tab === key
                                    ? "bg-accent text-foreground"
                                    : "text-muted-foreground hover:bg-accent/60"
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {status === "loading" && (
                    <p className="text-sm text-muted-foreground">
                        {t("settings.loadingConfig")}
                    </p>
                )}
                {status === "error" && (
                    <p className="text-sm text-destructive">
                        {t("settings.loadFailed")}
                    </p>
                )}

                {status === "ready" && tab === "models" && (
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
                        <ToolsCard
                            tools={tools}
                            toolOn={toolOn}
                            onToggle={toggleTool}
                            toolCfg={toolCfg}
                            patchCfg={patchToolCfg}
                        />
                        <PermissionsCard
                            mode={permMode}
                            rules={permRules}
                            dangerPatterns={permDanger}
                            onMode={setPermMode}
                            onRules={setPermRules}
                            onDangerPatterns={setPermDanger}
                        />
                    </>
                )}
                {status === "ready" && tab === "integrations" && (
                    <>
                        <McpCard
                            mcp={mcp}
                            patchMcp={patchMcp}
                            addMcp={addMcp}
                            removeMcp={removeMcp}
                        />
                    </>
                )}
                {yamlOpen && (
                    <YamlEditorModal
                        onClose={() => setYamlOpen(false)}
                        onSaved={reloadConfig}
                    />
                )}
            </div>
        </div>
    );
}