import { join } from "node:path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as yaml from "js-yaml";
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
 */
export interface LlmProvider {
    apiKey: string;
    baseURL?: string;
    models: LlmModel[];
    defaultModel: string;
    streaming: boolean;
    contextWindow: number;
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
            contextWindow: p.contextWindow ?? 128000,
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
                        contextWindow: 128000,
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
        if (!providers[def]) {
            throw new Error(`配置文件 ${file} 的 default="${def}" 未在 providers 中定义。`);
        }
        for (const [name, p] of Object.entries(providers)) {
            if (!p.models.length) {
                throw new Error(`配置文件 ${file} 的 provider "${name}" 未定义 models。`);
            }
            if (!p.models.some((m) => m.id === p.defaultModel)) {
                throw new Error(
                    `配置文件 ${file} 的 provider "${name}" 的 defaultModel="${p.defaultModel}" 未在 models 中。`
                );
            }
        }
        const mcpServers = parsed?.mcp ?? {};
        return new Config(providers, def, mcpServers);
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
        if (!Object.keys(providers).length) {
            throw new Error("providers 不能为空");
        }
        const def = data.default ?? Object.keys(providers)[0];
        if (!providers[def]) {
            throw new Error(`default="${def}" 未在 providers 中定义`);
        }
        for (const [name, p] of Object.entries(providers)) {
            if (!p.models.length) {
                throw new Error(`provider "${name}" 的 models 不能为空`);
            }
            if (!p.models.some((m) => m.id === p.defaultModel)) {
                throw new Error(
                    `provider "${name}" 的 defaultModel="${p.defaultModel}" 未在 models 中`
                );
            }
        }
        for (const [name, s] of Object.entries(data.mcp ?? {})) {
            if (s && s.type !== "stdio" && s.type !== "sse" && s.type !== undefined) {
                throw new Error(`mcp server "${name}" type 非法（需 stdio/sse）`);
            }
        }
        mkdirSync(globalConfigDir(), { recursive: true });
        writeFileSync(
            file,
            yaml.dump({ providers, default: def, mcp: data.mcp ?? {} }),
            "utf-8"
        );
    }
}
