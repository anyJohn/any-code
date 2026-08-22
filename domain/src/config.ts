import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import * as yaml from "js-yaml";
import type { Workspace } from "./workspace";
import { workspaceConfigDir } from "./workspace";

/**
 * 一个 LLM provider 的连接设置。streaming 粒度在 provider 层。
 * 所有配置只来自 <workspace>/.anycode/config.yaml，不再读环境变量。
 */
export interface LlmProvider {
    apiKey: string;
    baseURL?: string;
    model: string;
    streaming: boolean;
}

interface ConfigShape {
    providers?: Record<string, Partial<LlmProvider>>;
    default?: string;
}

/** streaming 缺省 true（向后兼容流式默认） */
function normalize(
    providers: Record<string, Partial<LlmProvider>>
): Record<string, LlmProvider> {
    const out: Record<string, LlmProvider> = {};
    for (const [name, p] of Object.entries(providers)) {
        out[name] = {
            apiKey: p.apiKey ?? "",
            baseURL: p.baseURL,
            model: p.model ?? "",
            streaming: p.streaming ?? true,
        };
    }
    return out;
}

/**
 * 配置加载器：唯一来源 <workspace>/.anycode/config.yaml（命名 provider map + default + streaming）。
 * 无文件 / 无 provider / default 未定义 → 抛错（引导用户建配置）。
 * 热更新：reload() 重读文件，供 web 改配置后触发。
 */
export class Config {
    providers: Record<string, LlmProvider>;
    default: string;
    private workspace: Workspace;

    private constructor(
        workspace: Workspace,
        providers: Record<string, LlmProvider>,
        def: string
    ) {
        this.workspace = workspace;
        this.providers = providers;
        this.default = def;
    }

    static load(workspace: Workspace): Config {
        const file = join(workspaceConfigDir(workspace), "config.yaml");
        if (!existsSync(file)) {
            throw new Error(
                `配置文件不存在：${file}。请复制仓库根的 config.example.yaml 到 <workspace>/.anycode/config.yaml 并填写。`
            );
        }
        const parsed = yaml.load(readFileSync(file, "utf-8")) as ConfigShape | null;
        const providers = normalize(parsed?.providers ?? {});
        if (!Object.keys(providers).length) {
            throw new Error(`配置文件 ${file} 未定义任何 provider。`);
        }
        const def = parsed?.default ?? Object.keys(providers)[0];
        if (!providers[def]) {
            throw new Error(
                `配置文件 ${file} 的 default="${def}" 未在 providers 中定义。`
            );
        }
        return new Config(workspace, providers, def);
    }

    /** 当前生效 provider（按 default 字段） */
    getCurrentProvider(): LlmProvider {
        return this.providers[this.default];
    }

    /** 热更新：重读配置文件，新 default/provider 生效（下次 callLLM 用新值） */
    reload(): void {
        const fresh = Config.load(this.workspace);
        this.providers = fresh.providers;
        this.default = fresh.default;
    }
}
