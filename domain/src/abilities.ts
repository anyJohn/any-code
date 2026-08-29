import type { McpServerConfig } from "./mcp";
import type { Config } from "./config";

/**
 * 能力（ability）注册器 —— RR-025 / SPEC-031。
 * 内置能力 = 内置连接器（kind:"mcp"，bundled stdio server，并入 loadMcpTools 连接集）。
 * 技能不在注册器内——技能是纯文件（项目/全局/.agents/skills，与外部同标准）。
 * 不可删除（无 unregister）；启用与否由 config.abilities 决定（未配置=关，随包默认 config 开）。
 */
export interface Ability {
    name: string;
    description: string;
    kind: "mcp";
    /** bundled 自包含 stdio MCP server（command/args 随包分发，离线自包含） */
    server: McpServerConfig;
}

/** 注册表：name → Ability。模块级单例，builtin.ts 在 import 时注册。 */
const registry = new Map<string, Ability>();

/**
 * 注册能力。层内同名 → fail-fast throw（SPE-031 B-001 / I-001，抄 deepseek NamedEntries）。
 * 只读注册、无 unregister——内置能力不可删除（SPEC-031 C-001）。
 */
export function registerAbility(a: Ability): void {
    if (registry.has(a.name)) {
        throw new Error(`Ability "${a.name}" 已注册（能力名必须唯一）`);
    }
    registry.set(a.name, a);
}

/** 全部已注册能力（插入序）。Settings 面板与目录注入共用此源。 */
export function getRegisteredAbilities(): Ability[] {
    return [...registry.values()];
}

export function getAbility(name: string): Ability | undefined {
    return registry.get(name);
}

/**
 * 能力启用决议（SPEC-031 B-002 / C-004）：未配置 = 不启用。
 * 用户 config 的 `abilities.<name>.enabled` 显式 true 才启用；随包默认 config 预置三能力开启。
 * reloadConfig 后再次解析即热生效（B-011）。
 */
export function isAbilityEnabled(config: Config, name: string): boolean {
    return config.abilities?.[name]?.enabled === true;
}