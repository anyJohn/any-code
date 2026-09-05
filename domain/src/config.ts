import { join } from "node:path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as yaml from "js-yaml";
import OpenAI from "openai";
import { globalConfigDir } from "./workspace";
import type { McpServerConfig } from "./mcp";
import { callLLM } from "./llm";
import {
    DEFAULT_DANGER_PATTERNS,
    type PermissionsConfig,
    type PermissionMode,
    type PermissionRule,
} from "./permissions";

/**
 * 一个模型：id（调 API 的真实模型名）+ name（展示名，可选）。
 */
export interface LlmModel {
    id: string;
    name?: string;
}

/**
 * 一个 LLM provider 的连接设置。支持多模型：models 列表 + defaultModel（当前生效 id）。
 * 配置全局：~/.anycode/config.yaml（跨工作区共享）。
 * contextWindow optional：undefined=用户未配，由 resolveContextWindow 探测/表/128000 兜底。
 * maxOutputTokens optional：undefined=用户未配 → callLLM 不传 max_tokens（provider 默认）。
 *   纯用户覆盖项，不探测/不取 min（照业界主流 harness 保守做法：不拿无人选的数 cap 每次请求）。SPEC-023。
 */
export interface LlmProvider {
    apiKey: string;
    baseURL?: string;
    models: LlmModel[];
    defaultModel: string;
    streaming: boolean;
    contextWindow?: number;
    /** 最大输出 token；用户配则传 max_tokens，undefined 不传（provider 默认）。SPEC-023 */
    maxOutputTokens?: number;
    /** LLM 调用重试（AR-1）：maxRetries 默认 3、baseDelayMs 默认 1000（指数退避+抖动，Retry-After 优先）。 */
    retry?: { maxRetries?: number; baseDelayMs?: number };
    /** 协议适配（AR-15）：openai（缺省，Chat Completions）/ anthropic（Messages API）。 */
    protocol?: "openai" | "anthropic";
}

/**
 * 内置模型上下文表（仅确信值，公开规格）。probe 与用户配置优先于表（resolve 取 min）。
 */
const MODEL_CONTEXT_TABLE: Record<string, number> = {
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-3.5-turbo": 16385,
    // zhipu glm-5 系列（用户实测确认 flash 支持 1M；其余 glm 未确认不乱填）
    "glm-5.3-flash": 1000000,
};

/**
 * 解析最终 contextWindow：candidates = [探测值, 模型表值, 用户配置] 去空 → Math.min；全空 → 128000。
 * 取 min 保证不超真实窗口（用户配更小则用更小）。SPEC-019 B-003 / DEC-063。
 */
export function resolveContextWindow(
    provider: LlmProvider,
    detected?: number
): number {
    const cands: number[] = [];
    if (typeof detected === "number") cands.push(detected);
    const tableVal = MODEL_CONTEXT_TABLE[provider.defaultModel];
    if (typeof tableVal === "number") cands.push(tableVal);
    if (typeof provider.contextWindow === "number")
        cands.push(provider.contextWindow);
    return cands.length ? Math.min(...cands) : 128000;
}

const detectCache = new Map<
    string,
    { value: number | undefined; ts: number }
>();
const DETECT_CACHE_TTL = 3600_000; // 1h——模型 context 基本不变

function extractContext(m: unknown): number | undefined {
    if (!m || typeof m !== "object") return undefined;
    const rec = m as Record<string, unknown>;
    const v =
        rec.context_window ?? rec.context_length ?? rec.max_context_length;
    return typeof v === "number" ? v : undefined;
}

/**
 * 探测 provider 的 GET /models 是否返回真实 context window（仅 contextWindow，不取 max_output_tokens）。
 * OpenAI 官方新版 API 返回 context_window；多数兼容 provider 不返回 → undefined，回退到表/用户/128000。
 * SPEC-019 B-002。带 module-level 缓存（1h TTL）。maxOutputTokens 不探测（照业界主流 harness，探测不进请求路径）。
 */
export async function detectContextWindow(
    provider: LlmProvider
): Promise<number | undefined> {
    if (!provider.apiKey || !provider.defaultModel) return undefined;
    const key = `${provider.baseURL ?? "default"}|${provider.defaultModel}`;
    const hit = detectCache.get(key);
    if (hit && Date.now() - hit.ts < DETECT_CACHE_TTL) return hit.value;
    let value: number | undefined;
    try {
        const client = new OpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.baseURL,
        });
        const list = await client.models.list();
        const arr = (list as unknown as { data?: unknown[] }).data ?? [];
        const m = arr.find(
            (x) => (x as { id?: string })?.id === provider.defaultModel
        );
        value = extractContext(m);
    } catch {
        value = undefined;
    }
    detectCache.set(key, { value, ts: Date.now() });
    return value;
}

/**
 * 从 provider 拉取模型 id 列表（OpenAI SDK GET {baseURL}/models）。
 * Settings「拉取模型」用——验证 baseURL/apiKey 后填充 models 列表。
 * 失败抛错（apiKey 缺失/网络/401），由调用方回传 UI。
 */
export async function listModels(
    baseURL: string | undefined,
    apiKey: string | undefined
): Promise<string[]> {
    if (!apiKey?.trim()) throw new Error("需要 apiKey 才能拉取模型");
    const client = new OpenAI({ apiKey, baseURL });
    const list = await client.models.list();
    const arr =
        (list as unknown as { data?: Array<{ id?: string }> }).data ?? [];
    return arr.map((m) => m.id ?? "").filter(Boolean);
}

/** 单个模型测试结果（参考 LLM_Proxy provider_model_test_service）。 */
export interface ModelTestResult {
    requested_model: string;
    available: boolean;
    /** 首字延迟（ms，流式 ping 首个 delta） */
    first_token_latency_ms?: number;
    total_ms?: number;
    error?: string;
}

/**
 * 测试单个模型可用性 + 首字延迟（流式 ping，max_tokens 极小）。
 * Settings「测试模型」用。容错：失败返回 available:false + error，不抛。
 */
export async function testModel(
    baseURL: string | undefined,
    apiKey: string | undefined,
    model: string
): Promise<ModelTestResult> {
    const provider: LlmProvider = {
        apiKey: apiKey ?? "",
        baseURL,
        models: [{ id: model }],
        defaultModel: model,
        streaming: true,
    };
    const t0 = performance.now();
    let firstTokenMs: number | undefined;
    try {
        await callLLM(
            [{ role: "user", content: "Reply with exactly: ok" }],
            { max_tokens: 16, temperature: 0, tools: undefined },
            undefined,
            () => {
                if (firstTokenMs === undefined)
                    firstTokenMs = Math.round(performance.now() - t0);
            },
            provider
        );
        return {
            requested_model: model,
            available: true,
            first_token_latency_ms: firstTokenMs,
            total_ms: Math.round(performance.now() - t0),
        };
    } catch (e) {
        return {
            requested_model: model,
            available: false,
            total_ms: Math.round(performance.now() - t0),
            error: e instanceof Error ? e.message : String(e),
        };
    }
}

/** 批量测试模型（并发），保持传入顺序。 */
export async function testModels(
    baseURL: string | undefined,
    apiKey: string | undefined,
    models: string[]
): Promise<ModelTestResult[]> {
    return Promise.all(models.map((m) => testModel(baseURL, apiKey, m)));
}

export interface ConfigShape {
    providers?: Record<string, Partial<LlmProvider>>;
    default?: string;
    mcp?: Record<string, McpServerConfig>;
    /** Windows 上 agent bash 工具用的 shell 路径（config.yaml 配，非 env）。install.ps1 写入 busybox sh.exe 路径。 */
    gitBashPath?: string;
    /** 工具权限配置（SPEC-032）：模式 + 用户规则 + 危险命令基线增删。 */
    permissions?: PermissionsConfig;
    /** server 并发运行上限（FR-30 / SPEC-033 DEC-102）：缺省 3，0 = 不限。 */
    maxConcurrentRuns?: number;
    /** 界面偏好（FR-29）：language = 界面语言（缺省跟随系统语言）。 */
    ui?: { language?: "zh" | "en" };
    /** 模型单价（FR-22）：美元 / 每 1M tokens。缺省不配 → 界面只显 tokens 不显费用。 */
    pricing?: Record<string, ModelPricing>;
    /** 全局出网代理（用户决策 2026-09-03）：所有联网操作（LLM / web 工具 / MCP SSE）统一走此代理。 */
    proxy?: string;
    /** 代理豁免清单（逗号分隔，支持后缀匹配）；本地回环始终直连。 */
    noProxy?: string;
    /** 通用工具开关与配置（用户决策 2026-09-03）：key = 工具名；enabled=false 剔除该工具（未配置 = 启用）。 */
    tools?: Record<string, ToolConfigEntry>;
    /** 记忆注入（SPEC-035 B-004）：maxChars = 两层合并后的注入截断窗口。 */
    memory?: { maxChars?: number };
    /** @deprecated 旧内置能力段（SPEC-031）——load 时迁移到 tools 段，保存不再写出。 */
    abilities?: Record<string, AbilityConfig>;
}

/** 模型单价（FR-22）：input/output = 每百万 tokens 的美元单价。 */
export interface ModelPricing {
    input: number;
    output: number;
}

/** 通用工具条目（用户决策 2026-09-03）：每个工具可开关 + 私有配置。 */
export interface ToolConfigEntry {
    /** 显式 false = 从工具集剔除；未配置 / true = 启用 */
    enabled?: boolean;
    /** 工具私有配置（web_search: provider/apiKey；browser_*: cdpUrl…），经 ctx.toolsConfig 注入 */
    config?: Record<string, unknown>;
}

/** 单个能力配置：enabled 开关 + 能力私有 config（如 web-search 的 provider/apiKey）。 */
export interface AbilityConfig {
    enabled?: boolean;
    config?: Record<string, unknown>;
}

/** apiKey 脱敏（前4后4，过短则 ****） */
export function maskApiKey(key: string): string {
    if (!key) return "";
    if (key.length <= 8) return "****";
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/** streaming 缺省 true；models/defaultModel 缺省取首个 */
function normalize(
    providers: Record<string, Partial<LlmProvider>>
): Record<string, LlmProvider> {
    const out: Record<string, LlmProvider> = {};
    for (const [name, p] of Object.entries(providers)) {
        const models = p.models ?? [];
        out[name] = {
            apiKey: p.apiKey ?? "",
            baseURL: p.baseURL,
            models,
            defaultModel: p.defaultModel ?? models[0]?.id ?? "",
            streaming: p.streaming ?? true,
            contextWindow: p.contextWindow,
            maxOutputTokens: p.maxOutputTokens,
            retry: p.retry,
            protocol: p.protocol === "anthropic" ? "anthropic" : "openai",
        };
    }
    return out;
}

function globalConfigFile(): string {
    return join(globalConfigDir(), "config.yaml");
}

/**
 * 配置加载器：唯一来源 ~/.anycode/config.yaml（全局，命名 provider map + models + defaultModel + mcp）。
 * 无文件 → 自动创建默认模板；无 provider / default 未定义 / provider 无 models / defaultModel 不在 models → 抛错。
 * 热更新：reload() 重读文件。
 */
export class Config {
    providers: Record<string, LlmProvider>;
    default: string;
    mcpServers: Record<string, McpServerConfig>;
    /** Windows agent bash 用的 Git Bash 路径（~/.anycode/config.yaml 顶层 gitBashPath）。 */
    gitBashPath?: string;
    /** 全局出网代理（用户决策 2026-09-03）：undefined = 不走代理（环境变量仍生效，经 netProxy）。 */
    proxy?: string;
    /** 代理豁免清单（逗号分隔）；本地回环始终直连。 */
    noProxy?: string;
    /** 通用工具开关与配置（用户决策 2026-09-03）：enabled=false 的工具从注册表剔除。 */
    tools: Record<string, ToolConfigEntry>;
    /** 工具权限配置（SPEC-032）：模式 + 全局规则 + 危险基线增删。 */
    permissions: Required<PermissionsConfig>;
    /** server 并发运行上限（FR-30）：缺省 3，0 = 不限。server 侧消费，domain 仅承载。 */
    maxConcurrentRuns: number;
    /** 界面偏好（FR-29）：language 缺省 undefined = 跟随系统语言。 */
    ui: { language?: "zh" | "en" };
    /** 模型单价（FR-22）：缺省空表 → 界面只显 tokens。 */
    pricing: Record<string, ModelPricing>;
    /** 记忆注入（SPEC-035）：maxChars = 注入截断窗口，缺省 4000。 */
    memory: { maxChars: number };

    private constructor(
        providers: Record<string, LlmProvider>,
        def: string,
        mcpServers: Record<string, McpServerConfig>,
        gitBashPath: string | undefined,
        proxy: string | undefined,
        noProxy: string | undefined,
        tools: Record<string, ToolConfigEntry>,
        permissions: Required<PermissionsConfig>,
        maxConcurrentRuns: number,
        ui: { language?: "zh" | "en" },
        pricing: Record<string, ModelPricing>,
        memory: { maxChars: number }
    ) {
        this.providers = providers;
        this.default = def;
        this.mcpServers = mcpServers;
        this.gitBashPath = gitBashPath;
        this.proxy = proxy;
        this.noProxy = noProxy;
        this.tools = tools;
        this.permissions = permissions;
        this.maxConcurrentRuns = maxConcurrentRuns;
        this.ui = ui;
        this.pricing = pricing;
        this.memory = memory;
    }

    static load(): Config {
        const file = globalConfigFile();
        if (!existsSync(file)) {
            // 首次启动：自动创建默认配置模板（用户经 /settings 填 apiKey）。
            // tools：web_fetch / web_search 缺省开；browser_*（CDP）需浏览器调试端口，缺省关。
            Config.save({
                providers: {
                    default: {
                        apiKey: "",
                        baseURL: undefined,
                        models: [{ id: "gpt-4o", name: "GPT-4o" }],
                        defaultModel: "gpt-4o",
                        streaming: true,
                    },
                },
                default: "default",
                tools: {
                    web_fetch: { enabled: true },
                    web_search: {
                        enabled: true,
                        config: { provider: "ddg", apiKey: "" },
                    },
                    browser_use: {
                        enabled: false,
                        config: { cdpUrl: "http://localhost:9222" },
                    },
                },
            });
        }
        const parsed = yaml.load(
            readFileSync(file, "utf-8")
        ) as ConfigShape | null;
        const providers = normalize(parsed?.providers ?? {});
        if (!Object.keys(providers).length) {
            throw new Error(`配置文件 ${file} 未定义任何 provider。`);
        }
        const def = parsed?.default ?? Object.keys(providers)[0];
        // lenient：default 不在 providers → 用首个；defaultModel 不在 models → 用首个 model。
        // 不抛错——让 /settings 能加载（修正后的）坏配置供编辑覆写，agent 也能 best-effort 启动。
        const resolvedDef = providers[def] ? def : Object.keys(providers)[0];
        for (const p of Object.values(providers)) {
            if (
                p.models.length &&
                !p.models.some((m) => m.id === p.defaultModel)
            ) {
                p.defaultModel = p.models[0].id;
            }
        }
        const mcpServers = parsed?.mcp ?? {};
        return new Config(
            providers,
            resolvedDef,
            mcpServers,
            parsed?.gitBashPath,
            normalizeProxy(parsed?.proxy),
            normalizeNoProxy(parsed?.noProxy),
            normalizeTools(parsed?.tools, parsed?.abilities),
            normalizePermissions(parsed?.permissions),
            normalizeMaxConcurrentRuns(parsed?.maxConcurrentRuns),
            normalizeUi(parsed?.ui),
            normalizePricing(parsed?.pricing),
            normalizeMemory(parsed?.memory)
        );
    }

    /** 当前生效 provider（按 default 字段） */
    getCurrentProvider(): LlmProvider {
        return this.providers[this.default];
    }

    /** 校验 + 写回 ~/.anycode/config.yaml（js-yaml dump）。覆盖前先备份原配置到 config.yaml.bak，供误配置回滚。 */
    static save(data: ConfigShape): void {
        const file = globalConfigFile();
        // 备份原配置（若存在）→ config.yaml.bak，覆盖前的安全网
        if (existsSync(file)) {
            try {
                writeFileSync(
                    file + ".bak",
                    readFileSync(file, "utf-8"),
                    "utf-8"
                );
            } catch {
                // 备份失败不阻断保存
            }
        }
        const providers = normalize(data.providers ?? {});
        const errors: string[] = [];
        const def = data.default ?? Object.keys(providers)[0];
        if (!Object.keys(providers).length) {
            errors.push("providers 不能为空");
        } else {
            if (!providers[def]) {
                errors.push(`default="${def}" 未在 providers 中定义`);
            }
            for (const [name, p] of Object.entries(providers)) {
                if (!p.models.length) {
                    errors.push(`provider "${name}" 的 models 不能为空`);
                } else if (!p.models.some((m) => m.id === p.defaultModel)) {
                    errors.push(
                        `provider "${name}" 的 defaultModel="${p.defaultModel}" 未在 models 中`
                    );
                }
            }
        }
        for (const [name, s] of Object.entries(data.mcp ?? {})) {
            if (
                s &&
                s.type !== "stdio" &&
                s.type !== "sse" &&
                s.type !== undefined
            ) {
                errors.push(`mcp server "${name}" type 非法（需 stdio/sse）`);
            }
        }
        if (errors.length) {
            throw new Error(errors.join("\n"));
        }
        mkdirSync(globalConfigDir(), { recursive: true });
        writeFileSync(
            file,
            yaml.dump({
                providers,
                default: def,
                mcp: data.mcp ?? {},
                gitBashPath: data.gitBashPath,
                // abilities 段已废弃（迁移到 tools），保存不再写出
                permissions: normalizePermissions(data.permissions),
                maxConcurrentRuns: normalizeMaxConcurrentRuns(data.maxConcurrentRuns),
                ui: normalizeUi(data.ui),
                pricing: normalizePricing(data.pricing),
                proxy: normalizeProxy(data.proxy),
                noProxy: normalizeNoProxy(data.noProxy),
                tools: normalizeTools(data.tools),
                memory: normalizeMemory(data.memory),
            }),
            "utf-8"
        );
    }
}

/** maxConcurrentRuns 归一化（FR-30 DEC-102）：缺省 3，0 = 不限，负数/非数字回退缺省。 */
export const DEFAULT_MAX_CONCURRENT_RUNS = 3;
function normalizeMaxConcurrentRuns(v?: number): number {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        return DEFAULT_MAX_CONCURRENT_RUNS;
    }
    return Math.floor(v);
}

/** ui 段归一化（FR-29）：language 仅接受 zh/en，其余视为未设置（跟随系统语言）。 */
function normalizeUi(v?: { language?: "zh" | "en" }): { language?: "zh" | "en" } {
    const language = v?.language === "zh" || v?.language === "en" ? v.language : undefined;
    return language ? { language } : {};
}

/** memory 段归一化（SPEC-035 B-004）：maxChars 正整数，缺省 4000（原硬编码窗口值）。 */
export const DEFAULT_MEMORY_MAX_CHARS = 4000;
function normalizeMemory(v?: { maxChars?: number }): { maxChars: number } {
    const n = v?.maxChars;
    const maxChars =
        typeof n === "number" && Number.isFinite(n) && n >= 1
            ? Math.floor(n)
            : DEFAULT_MEMORY_MAX_CHARS;
    return { maxChars };
}

/** pricing 段归一化（FR-22）：仅保留 input/output 均为正数的条目。 */
function normalizePricing(
    v?: Record<string, ModelPricing>
): Record<string, ModelPricing> {
    const out: Record<string, ModelPricing> = {};
    for (const [model, p] of Object.entries(v ?? {})) {
        if (
            p &&
            typeof p.input === "number" &&
            Number.isFinite(p.input) &&
            p.input > 0 &&
            typeof p.output === "number" &&
            Number.isFinite(p.output) &&
            p.output > 0
        ) {
            out[model] = { input: p.input, output: p.output };
        }
    }
    return out;
}

export interface SwitchResult {
    ok: boolean;
    message: string;
}

/** 切换默认模型（校验 model 在当前 provider 的 models 中）。 */
export function switchDefaultModel(modelId: string): SwitchResult {
    const cfg = Config.load();
    const provider = cfg.providers[cfg.default];
    if (!provider) return { ok: false, message: `provider "${cfg.default}" 不存在` };
    if (!provider.models.some((m) => m.id === modelId)) {
        return {
            ok: false,
            message: `model "${modelId}" 不在 provider "${cfg.default}" 的 models 中`,
        };
    }
    provider.defaultModel = modelId;
    saveFull(cfg);
    return { ok: true, message: modelId };
}

/** 设置界面语言（FR-29，全字段回写）。仅接受 zh/en。 */
export function setUiLanguage(language: string): SwitchResult {
    if (language !== "zh" && language !== "en") {
        return { ok: false, message: "language 仅支持 zh / en" };
    }
    const cfg = Config.load();
    cfg.ui = { ...cfg.ui, language };
    saveFull(cfg);
    return { ok: true, message: language };
}

/** 切换默认 provider（校验存在）。 */
export function switchDefaultProvider(name: string): SwitchResult {
    const cfg = Config.load();
    if (!cfg.providers[name]) {
        return { ok: false, message: `provider "${name}" 不存在` };
    }
    cfg.default = name;
    saveFull(cfg);
    return { ok: true, message: name };
}

/** 全字段回写（与 server PATCH 同语义：非目标段原样保留，防误清）。 */
function saveFull(cfg: Config): void {
    Config.save({
        providers: cfg.providers,
        default: cfg.default,
        mcp: cfg.mcpServers,
        gitBashPath: cfg.gitBashPath,
        permissions: cfg.permissions,
        maxConcurrentRuns: cfg.maxConcurrentRuns,
        ui: cfg.ui,
        pricing: cfg.pricing,
        tools: cfg.tools,
        proxy: cfg.proxy,
        noProxy: cfg.noProxy,
    });
}

/** proxy 归一化（用户决策 2026-09-03）：仅接受 http(s):// URL，其余视为未设置。 */
function normalizeProxy(v?: string): string | undefined {
    if (typeof v !== "string" || !v.trim()) return undefined;
    try {
        const u = new URL(v.trim());
        return u.protocol === "http:" || u.protocol === "https:" ? u.origin : undefined;
    } catch {
        return undefined;
    }
}

/** noProxy 归一化：字符串原样（逗号分隔，EnvHttpProxyAgent 解析），仅 trim。 */
function normalizeNoProxy(v?: string): string | undefined {
    const s = typeof v === "string" ? v.trim() : "";
    return s || undefined;
}

/** 旧 abilities 段 → tools 段的 key 映射（用户决策 2026-09-03）。 */
const ABILITY_TOOL_MAP: Record<string, string[]> = {
    "web-fetch": ["web_fetch"],
    "web-search": ["web_search"],
    "browser-use": ["browser_use"],
};

/** tools 段归一化：enabled 仅认 boolean；config 仅收对象。旧 abilities 段迁移（tools 显式条目优先）。 */
function normalizeTools(
    v?: Record<string, ToolConfigEntry>,
    legacyAbilities?: Record<string, AbilityConfig>
): Record<string, ToolConfigEntry> {
    const out: Record<string, ToolConfigEntry> = {};
    for (const [name, e] of Object.entries(v ?? {})) {
        if (!e || typeof e !== "object") continue;
        const entry: ToolConfigEntry = {};
        if (typeof e.enabled === "boolean") entry.enabled = e.enabled;
        if (e.config && typeof e.config === "object" && !Array.isArray(e.config)) {
            entry.config = e.config;
        }
        out[name] = entry;
    }
    for (const [abilityName, e] of Object.entries(legacyAbilities ?? {})) {
        const toolNames = ABILITY_TOOL_MAP[abilityName];
        if (!toolNames || !e || typeof e !== "object") continue;
        for (const toolName of toolNames) {
            if (out[toolName]) continue; // tools 段显式条目优先
            const entry: ToolConfigEntry = {};
            if (typeof e.enabled === "boolean") entry.enabled = e.enabled;
            if (e.config && typeof e.config === "object" && !Array.isArray(e.config)) {
                entry.config = e.config;
            }
            out[toolName] = entry;
        }
    }
    return out;
}

/** permissions 段归一化：mode 缺省 standard；dangerPatterns 缺省内置集（D-005）。 */
function normalizePermissions(p?: PermissionsConfig): Required<PermissionsConfig> {
    const mode: PermissionMode =
        p?.mode === "accept_edits" || p?.mode === "trusted" ? p.mode : "standard";
    const rules: PermissionRule[] = (p?.rules ?? []).filter(
        (r) =>
            r &&
            typeof r.tool === "string" &&
            (r.action === "allow" || r.action === "ask" || r.action === "deny")
    );
    const dangerPatterns =
        p?.dangerPatterns && Array.isArray(p.dangerPatterns)
            ? p.dangerPatterns.filter((x) => typeof x === "string")
            : [...DEFAULT_DANGER_PATTERNS];
    return { mode, rules, dangerPatterns };
}
