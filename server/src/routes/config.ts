/** config 路由（自 index.ts 机械拆分，零逻辑改动）。 */
import {
    Config,
    bashCandidates,
    createWorkspace,
    listModels,
    loadProjectPermissions,
    maskApiKey,
    resolveShellKind,
    saveProjectPermissions,
    setGitBashPath,
    setUiLanguage,
    setUiTheme,
    switchDefaultModel,
    switchDefaultProvider,
    testModels,
    toolCatalog,
    type ConfigShape,
    type PermissionRule,
} from "@any-code/domain";
import { resolveModelCreds } from "../shared.js";
import { existsSync } from "node:fs";

import type { Hono } from "hono";

export function registerConfigRoutes(app: Hono): void {
    // ==================== config ====================
    app.get("/api/config", (c) => {
        try {
            const cfg = Config.load();
            const shellStatus = (hint?: string) => {
                const kind = resolveShellKind(hint);
                const binary = bashCandidates(hint)[0];
                return { kind, path: binary ?? null, platform: process.platform };
            };
            const providers: Record<string, unknown> = {};
            for (const [name, p] of Object.entries(cfg.providers)) {
                providers[name] = { ...p, apiKey: maskApiKey(p.apiKey) };
            }
            // 通用工具目录（用户决策 2026-09-03）：全量工具 + config.tools 开关态
            const catalog = toolCatalog().map((t) => ({
                name: t.name,
                description: t.description,
                readOnly: t.readOnly,
                enabled: cfg.tools[t.name]?.enabled !== false,
            }));
            return c.json({
                providers,
                default: cfg.default,
                mcp: cfg.mcpServers,
                tools: { catalog, config: cfg.tools },
                permissions: cfg.permissions,
                maxConcurrentRuns: cfg.maxConcurrentRuns,
                ui: cfg.ui,
                pricing: cfg.pricing,
                proxy: cfg.proxy,
                noProxy: cfg.noProxy,
                // bash 工具链状态（设置页「通用」展示；busybox = 工具链残缺，提示装 Git）
                shell: shellStatus(cfg.gitBashPath),
            });
        } catch {
            return c.json({ providers: {}, default: undefined, mcp: {} });
        }
    });

    app.post("/api/config", async (c) => {
        let body: ConfigShape;
        try {
            body = (await c.req.json()) as ConfigShape;
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        let existing: Config | null = null;
        try {
            existing = Config.load();
        } catch {
            // 无现有配置（首次写入）
        }
        const merged: ConfigShape = {
            providers: Object.fromEntries(
                Object.entries(body.providers ?? {}).map(([name, p]) => {
                    const keep = p.apiKey?.trim()
                        ? p.apiKey
                        : existing?.providers[name]?.apiKey ?? "";
                    return [name, { ...p, apiKey: keep }];
                }),
            ),
            default: body.default,
            mcp: body.mcp,
            // 表单不含 gitBashPath（Windows 专用，install.ps1/launcher 维护）——保留已存值
            gitBashPath: body.gitBashPath ?? existing?.gitBashPath,
            // 表单不含 permissions 段时保留已存值（Settings 权限卡与整表单保存共用此路由）
            permissions: body.permissions ?? existing?.permissions,
            // 表单不含 maxConcurrentRuns 时保留已存值（FR-30）
            maxConcurrentRuns: body.maxConcurrentRuns ?? existing?.maxConcurrentRuns,
            // 表单不含 ui 段时保留已存值（FR-29 语言偏好）
            ui: body.ui ?? existing?.ui,
            // 表单不含 pricing 段时保留已存值（FR-22 模型单价）
            pricing: body.pricing ?? existing?.pricing,
            // 表单不含 tools 段时保留已存值（通用工具开关；abilities 旧段已由 Config 迁移）
            tools: body.tools ?? existing?.tools,
            // 表单不含 proxy 时保留已存值（全局出网代理）
            proxy: body.proxy ?? existing?.proxy,
            noProxy: body.noProxy ?? existing?.noProxy,
        };
        try {
            Config.save(merged);
            return c.json({ statusMessage: "saved" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    // 拉取 provider 模型列表（Settings「拉取模型」）：{ baseURL, apiKey?, providerName? } → { models }
    // apiKey 表单留空 = 保留原值 → 用 config 已存 key（providerName 匹配）。
    app.post("/api/config/models/fetch", async (c) => {
        let body: {
            baseURL?: string;
            apiKey?: string;
            providerName?: string;
        };
        try {
            body = (await c.req.json()) as {
                baseURL?: string;
                apiKey?: string;
                providerName?: string;
            };
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const { key, base } = resolveModelCreds(
            body.baseURL,
            body.apiKey,
            body.providerName
        );
        if (!key) {
            return c.json(
                {
                    statusMessage:
                        "需要 apiKey（表单留空=保留原值——若本地已存 key 会自动用；新 provider 请先填 key 或保存后重试）",
                },
                400
            );
        }
        try {
            const models = await listModels(base, key);
            return c.json({ models });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    // 测试模型可用性（Settings「测试模型」）：{ baseURL, apiKey?, providerName?, models } → { results }
    app.post("/api/config/models/test", async (c) => {
        let body: {
            baseURL?: string;
            apiKey?: string;
            providerName?: string;
            models?: string[];
        };
        try {
            body = (await c.req.json()) as {
                baseURL?: string;
                apiKey?: string;
                providerName?: string;
                models?: string[];
            };
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        if (!body.models?.length) {
            return c.json({ statusMessage: "models 不能为空" }, 400);
        }
        const { key, base } = resolveModelCreds(
            body.baseURL,
            body.apiKey,
            body.providerName
        );
        if (!key) {
            return c.json(
                {
                    statusMessage:
                        "需要 apiKey（表单留空=保留原值——若本地已存 key 会自动用；新 provider 请先填 key 或保存后重试）",
                },
                400
            );
        }
        try {
            const results = await testModels(base, key, body.models);
            return c.json({ results });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    // config.yaml 原文读写（RR 设置优化：YAML 编辑器弹窗）。GET 含真实 apiKey——
    // 仅本机 127.0.0.1 UI 使用；POST 校验可解析后备份原文件再原样写入（保留注释/格式）。
    app.get("/api/config/raw", (c) => {
        const yaml = Config.loadRaw();
        if (yaml === null) return c.json({ statusMessage: "config not found" }, 404);
        return c.json({ yaml });
    });

    app.post("/api/config/raw", async (c) => {
        let body: { yaml?: string } = {};
        try {
            body = (await c.req.json()) as { yaml?: string };
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const text = body?.yaml;
        if (typeof text !== "string" || !text.trim())
            return c.json({ statusMessage: "yaml required" }, 400);
        try {
            Config.saveRaw(text);
            return c.json({ statusMessage: "saved" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 400);
        }
    });

    app.patch("/api/config", async (c) => {
        let body: { default?: string; modelId?: string; language?: string; theme?: string };
        try {
            body = (await c.req.json()) as {
                default?: string;
                modelId?: string;
                language?: string;
                theme?: string;
            };
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        // 切换实现收归 domain（switchDefault*/setUiLanguage 全字段回写，非目标段原样保留）
        if (body.modelId) {
            const r = switchDefaultModel(body.modelId);
            if (!r.ok) return c.json({ statusMessage: r.message }, 400);
            return c.json({ statusMessage: "switched" });
        }
        if (body.default) {
            const r = switchDefaultProvider(body.default.trim());
            if (!r.ok) return c.json({ statusMessage: r.message }, 400);
            return c.json({ statusMessage: "switched" });
        }
        if (body.language !== undefined) {
            const r = setUiLanguage(body.language);
            if (!r.ok) return c.json({ statusMessage: r.message }, 400);
            return c.json({ statusMessage: "switched" });
        }
        if (body.theme !== undefined) {
            const r = setUiTheme(body.theme);
            if (!r.ok) return c.json({ statusMessage: r.message }, 400);
            return c.json({ statusMessage: "switched" });
        }
        return c.json({ statusMessage: "需要 default / modelId / language / theme 之一" }, 400);
    });

    // 设置 Windows bash 路径（设置页「通用」；空 = 清除回落自动探测）。存在性在这里校验。
    app.patch("/api/config/shell", async (c) => {
        let body: { gitBashPath?: string };
        try {
            body = (await c.req.json()) as { gitBashPath?: string };
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const p = body.gitBashPath?.trim() ?? "";
        if (p && !existsSync(p))
            return c.json({ statusMessage: `路径不存在：${p}` }, 400);
        const r = setGitBashPath(p);
        if (!r.ok) return c.json({ statusMessage: r.message }, 400);
        const kind = resolveShellKind(r.message || undefined);
        const binary = bashCandidates(r.message || undefined)[0];
        return c.json({ statusMessage: "switched", shell: { kind, path: binary ?? null, platform: process.platform } });
    });

    // bash 候选清单（设置页「通用」下拉用）：PATH 探测结果。
    app.get("/api/config/shell/candidates", (c) => {
        let hint: string | undefined;
        try {
            hint = Config.load().gitBashPath;
        } catch {
            // 坏 config：当作未配置
        }
        return c.json({ candidates: bashCandidates(hint) });
    });

    // 裁决"永久允许/拒绝"落盘（SPEC-032 B-006）：单独小路由——避免 web 走整表单
    // POST /api/config（GET 的 apiKey 已脱敏，整表单回存会污染真实 key）。
    app.post("/api/config/permissions/rule", async (c) => {
        let body: {
            tool?: string;
            pattern?: string;
            action?: string;
            scope?: string;
            workspacePath?: string;
        } = {};
        try {
            body = await c.req.json();
        } catch {
            return c.json({ statusMessage: "invalid json body" }, 400);
        }
        const tool = body.tool?.trim();
        const action = body.action;
        const scope = body.scope === "global" ? "global" : "project";
        if (!tool || (action !== "allow" && action !== "ask" && action !== "deny"))
            return c.json({ statusMessage: "tool and action required" }, 400);
        const rule: PermissionRule = {
            tool,
            pattern: body.pattern?.trim() || undefined,
            action,
        };
        try {
            if (scope === "global") {
                const cfg = Config.load();
                cfg.permissions.rules.push(rule);
                // 全字段回写（原只传 6 段，其余被 normalize 重置成默认）
                Config.save({
                    providers: cfg.providers,
                    default: cfg.default,
                    mcp: cfg.mcpServers,
                    gitBashPath: cfg.gitBashPath,
                    tools: cfg.tools,
                    permissions: cfg.permissions,
                    maxConcurrentRuns: cfg.maxConcurrentRuns,
                    ui: cfg.ui,
                    pricing: cfg.pricing,
                    proxy: cfg.proxy,
                    noProxy: cfg.noProxy,
                    memory: cfg.memory,
                });
            } else {
                const workspacePath = body.workspacePath?.trim();
                if (!workspacePath)
                    return c.json({ statusMessage: "workspacePath required for project scope" }, 400);
                const ws = createWorkspace(workspacePath);
                let rules: PermissionRule[] = [];
                try {
                    rules = loadProjectPermissions(ws);
                } catch {
                    // 损坏文件：覆盖为仅含新规则（fail-safe）
                }
                saveProjectPermissions(ws, [...rules, rule]);
            }
            return c.json({ statusMessage: "saved" });
        } catch (e) {
            return c.json({ statusMessage: (e as Error).message }, 500);
        }
    });
}
