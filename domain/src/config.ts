import { join } from "node:path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as yaml from "js-yaml";
import OpenAI from "openai";
import { globalConfigDir } from "./workspace";
import type { McpServerConfig } from "./mcp";

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
 * contextWindow optional：undefined = 用户未配，由 resolveContextWindow 探测/模型表/128000 兜底。
 */
export interface LlmProvider {
    apiKey: string;
    baseURL?: string;
    models: LlmModel[];
    defaultModel: string;
    streaming: boolean;
    contextWindow?: number;
}

/**
 * 内置模型上下文表（仅确信值，公开规格）。probe 与用户配置优先于表（resolve 取 min）。
 * 不在表中的模型 → 探测或用户配置或 128000。
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

const detectCache = new Map<string, { value: number | undefined; ts: number }>();
const DETECT_CACHE_TTL = 3600_000; // 1h——模型 context 基本不变

function extractContext(m: unknown): number | undefined {
    if (!m || typeof m !== "object") return undefined;
    const rec = m as Record<string, unknown>;
    const v = rec.context_window ?? rec.context_length ?? rec.max_context_length;
    return typeof v === "number" ? v : undefined;
}

/**
 * 探测 provider 的 GET /models 是否返回真实 context window。OpenAI 官方新版 API 返回 context_window；
 * 多数兼容 provider（如 dashscope）不返回 → undefined，回退到表/用户/128000。SPEC-019 B-002。
 * 带 module-level 缓存（1h TTL），避免重复网络调用。
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

export interface ConfigShape {
    providers?: Record<string, Partial<LlmProvider>>;
    default?: string;
    mcp?: Record<string, McpServerConfig>;
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

    private constructor(
        providers: Record<string, LlmProvider>,
        def: string,
        mcpServers: Record<string, McpServerConfig>
    ) {
        this.providers = providers;
        this.default = def;
        this.mcpServers = mcpServers;
    }

    static load(): Config {
        const file = globalConfigFile();
        if (!existsSync(file)) {
            // 首次启动：自动创建默认配置模板（用户经 /settings 填 apiKey）
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
            });
        }
        const parsed = yaml.load(readFileSync(file, "utf-8")) as ConfigShape | null;
        const providers = normalize(parsed?.providers ?? {});
        if (!Object.keys(providers).length) {
            throw new Error(`配置文件 ${file} 未定义任何 provider。`);
        }
        const def = parsed?.default ?? Object.keys(providers)[0];
        // lenient：default 不在 providers → 用首个；defaultModel 不在 models → 用首个 model。
        // 不抛错——让 /settings 能加载（修正后的）坏配置供编辑覆写，agent 也能 best-effort 启动。
        const resolvedDef = providers[def] ? def : Object.keys(providers)[0];
        for (const p of Object.values(providers)) {
            if (p.models.length && !p.models.some((m) => m.id === p.defaultModel)) {
                p.defaultModel = p.models[0].id;
            }
        }
        const mcpServers = parsed?.mcp ?? {};
        return new Config(providers, resolvedDef, mcpServers);
    }

    /** 当前生效 provider（按 default 字段） */
    getCurrentProvider(): LlmProvider {
        return this.providers[this.default];
    }

    /** 热更新：重读配置文件，新 default/provider/mcp 生效（下次 callLLM/initMcp 用新值） */
    reload(): void {
        const fresh = Config.load();
        this.providers = fresh.providers;
        this.default = fresh.default;
        this.mcpServers = fresh.mcpServers;
    }

    /** 校验 + 写回 ~/.anycode/config.yaml（js-yaml dump）。覆盖前先备份原配置到 config.yaml.bak，供误配置回滚。 */
    static save(data: ConfigShape): void {
        const file = globalConfigFile();
        // 备份原配置（若存在）→ config.yaml.bak，覆盖前的安全网
        if (existsSync(file)) {
            try {
                writeFileSync(file + ".bak", readFileSync(file, "utf-8"), "utf-8");
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
            if (s && s.type !== "stdio" && s.type !== "sse" && s.type !== undefined) {
                errors.push(`mcp server "${name}" type 非法（需 stdio/sse）`);
            }
        }
        if (errors.length) {
            throw new Error(errors.join("\n"));
        }
        mkdirSync(globalConfigDir(), { recursive: true });
        writeFileSync(
            file,
            yaml.dump({ providers, default: def, mcp: data.mcp ?? {} }),
            "utf-8"
        );
    }
}
