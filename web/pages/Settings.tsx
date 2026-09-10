"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT, type LanguagePref } from "@/i18n";
import { useTheme, type Theme } from "@/theme";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api";
import { isElectron } from "@/lib/electron";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * 设置页：全局配置 ~/.anycode/config.yaml 图形化编辑，热生效。
 * 三 tab（RR 设置优化 2026-09-06）：模型 | 工具与权限 | 集成。
 * 自动保存：配置态变化防抖 800ms 静默保存（校验失败/加载中跳过，失败 toast）；
 * 右上角"编辑 config.yaml"弹窗支持高亮编辑原文。
 * 数据在页面层统一持有，各卡片只收 props 渲染（见 settings/ 目录）。
 */
type SettingsTab = "general" | "models" | "tools" | "integrations";
export default function SettingsPage() {
    const { t, languagePref, setLanguage } = useT();
    const { theme, setTheme } = useTheme();
    const [shell, setShell] = useState<{ kind: string; path: string | null; platform?: string } | null>(null);
    // bash 路径草稿（输入框）+ 自动探测候选（datalist）+ 保存结果提示
    const [bashDraft, setBashDraft] = useState("");
    const [bashCandidates, setBashCandidates] = useState<string[]>([]);
    const [bashMsg, setBashMsg] = useState("");
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
    const [tab, setTab] = useState<SettingsTab>("general");
    const [yamlOpen, setYamlOpen] = useState(false);

    const reloadConfig = () => setLoadTick((k) => k + 1);
    const [loadTick, setLoadTick] = useState(0);

    /** 系统文件对话框选 bash.exe（桌面版兜底：PATH 探测不到时）。 */
    const browseBash = async () => {
        const picked = await window.anycode?.pickFile?.([
            { name: "bash.exe", extensions: ["exe"] },
        ]);
        if (picked) setBashDraft(picked);
    };

    /** 保存 bash 工具链路径（PATCH /api/config/shell）：空 = 清除显式配置回落自动探测。
     *  裸 fetch：400 校验错（路径不存在）的 statusMessage 要透给用户，apiJson 只回 null。 */
    const saveBashPath = async () => {
        setBashMsg("");
        try {
            const res = await fetch(`/api/config/shell`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ gitBashPath: bashDraft }),
            });
            const data = (await res.json().catch(() => ({}))) as {
                statusMessage?: string;
                shell?: { kind: string; path: string | null };
            };
            if (!res.ok) {
                setBashMsg(data.statusMessage ?? t("settings.bashSaveFail"));
                return;
            }
            if (data.shell) {
                setShell(data.shell);
                setBashDraft(data.shell.path ?? "");
            }
            setBashMsg(t("settings.bashSaved"));
        } catch {
            setBashMsg(t("settings.bashSaveFail"));
        }
    };

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
            setShell(res.shell ?? null);
            setBashDraft(res.shell?.path ?? "");
            // 探测候选（Windows 输入框 datalist）：失败静默——输入框仍可手填
            apiJson<{ candidates: string[] }>(`/api/config/shell/candidates`).then((r) => {
                if (r?.candidates) setBashCandidates(r.candidates);
            });
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
                            ["general", t("settings.tabGeneral")],
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
                    </>
                )}
                {status === "ready" && tab === "tools" && (
                    <>
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
                {status === "ready" && tab === "general" && (
                    <div className="rounded-lg border border-border p-4 flex flex-col gap-5">
                        <h2 className="text-sm font-semibold">{t("settings.generalTitle")}</h2>
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-sm">{t("settings.languageLabel")}</span>
                                <span className="text-xs text-muted-foreground">{t("settings.languageHint")}</span>
                            </div>
                            <Select value={languagePref} onValueChange={(v) => setLanguage(v as LanguagePref)}>
                                <SelectTrigger className="w-32">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="system">{t("settings.langSystem")}</SelectItem>
                                    <SelectItem value="zh">{t("settings.langZh")}</SelectItem>
                                    <SelectItem value="en">{t("settings.langEn")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-sm">{t("settings.themeLabel")}</span>
                                <span className="text-xs text-muted-foreground">{t("settings.themeHint")}</span>
                            </div>
                            <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                                <SelectTrigger className="w-32">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="system">{t("settings.themeSystem")}</SelectItem>
                                    <SelectItem value="light">{t("settings.themeLight")}</SelectItem>
                                    <SelectItem value="dark">{t("settings.themeDark")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {shell && (shell.kind === "busybox" || shell.kind === "none") && (
                            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                                <span className="text-xs text-amber-600 dark:text-amber-400">
                                    {t("settings.busyboxWarn")}{" "}
                                    <a
                                        href="https://git-scm.com/downloads/win"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="underline"
                                    >
                                        git-scm.com/downloads/win
                                    </a>
                                </span>
                            </div>
                        )}
                        {shell && (
                            <div className="flex flex-col gap-2">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-sm">{t("settings.bashLabel")}</span>
                                    {shell.platform === "win32" ? (
                                        <span className="text-xs text-muted-foreground">{t("settings.bashHint")}</span>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">{t("settings.bashHintUnix")}</span>
                                    )}
                                </div>
                                {shell.platform === "win32" && (
                                    <div className="flex items-center gap-2">
                                        <input
                                            value={bashDraft}
                                            onChange={(e) => setBashDraft(e.target.value)}
                                            list="bash-candidates"
                                            placeholder={t("settings.bashPlaceholder")}
                                            spellCheck={false}
                                            className="flex-1 text-xs font-mono rounded-md border border-input bg-background px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
                                        />
                                        <datalist id="bash-candidates">
                                            {bashCandidates.map((p) => (
                                                <option key={p} value={p} />
                                            ))}
                                        </datalist>
                                        {isElectron() && (
                                            <button
                                                onClick={browseBash}
                                                className="text-xs rounded-md border border-border px-2.5 py-1.5 hover:bg-accent shrink-0"
                                            >
                                                {t("settings.bashBrowse")}
                                            </button>
                                        )}
                                        <button
                                            onClick={saveBashPath}
                                            className="text-xs rounded-md border border-border px-2.5 py-1.5 hover:bg-accent shrink-0"
                                        >
                                            {t("settings.bashSave")}
                                        </button>
                                    </div>
                                )}
                                <div className="text-xs text-muted-foreground font-mono truncate" title={shell.path ?? ""}>
                                    bash: {shell.kind} · {shell.path ?? "-"}
                                    {bashMsg && <span className="ml-2">{bashMsg}</span>}
                                </div>
                            </div>
                        )}
                    </div>
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