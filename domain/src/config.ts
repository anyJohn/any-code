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
}

/**
 * 内置模型上下文表（仅确信值，公开规格）。probe 与用户配置优先于表（resolve 取 min）。
 */
const MODEL_CONTEXT_TABLE: Record<string, number> = {
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-3.5-turbo": 16385,
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
    /** 内置能力开关（SPEC-031）：未配置 = 不启用；随包默认 config 预置三能力开。条目可带 config（provider/连接器参数）。 */
    abilities?: Record<string, AbilityConfig>;
    /** 工具权限配置（SPEC-032）：模式 + 用户规则 + 危险命令基线增删。 */
    permissions?: PermissionsConfig;
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
    /** 内置能力开关（SPEC-031 B-002）：未配置 = 不启用。 */
    abilities: Record<string, AbilityConfig>;
    /** 工具权限配置（SPEC-032）：模式 + 全局规则 + 危险基线增删。 */
    permissions: Required<PermissionsConfig>;

    private constructor(
        providers: Record<string, LlmProvider>,
        def: string,
        mcpServers: Record<string, McpServerConfig>,
        gitBashPath: string | undefined,
        abilities: Record<string, AbilityConfig>,
        permissions: Required<PermissionsConfig>
    ) {
        this.providers = providers;
        this.default = def;
        this.mcpServers = mcpServers;
        this.gitBashPath = gitBashPath;
        this.abilities = abilities;
        this.permissions = permissions;
    }

    static load(): Config {
        const file = globalConfigFile();
        if (!existsSync(file)) {
            // 首次启动：自动创建默认配置模板（用户经 /settings 填 apiKey）。
            // abilities：随包默认 config 预置 web-fetch/web-search 开启（SPEC-031 B-002 / AC-003）；
            // browser-use（CDP）需 cdpUrl 默认关，用户配了再开。
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
                abilities: {
                    "web-fetch": { enabled: true },
                    "web-search": {
                        enabled: true,
                        config: { provider: "ddg", apiKey: "" },
                    },
                    "browser-use": {
                        enabled: false,
                        config: { cdpUrl: "http://127.0.0.1:9222" },
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
            parsed?.abilities ?? {},
            normalizePermissions(parsed?.permissions)
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
                abilities: data.abilities ?? {},
                permissions: normalizePermissions(data.permissions),
            }),
            "utf-8"
        );
    }
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
