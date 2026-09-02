import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ChatCompletionTool } from "openai/resources/index";
import type { Tool, ToolResult } from "./tools";
import type { ToolMeta } from "./tools";
import type { Workspace } from "./workspace";
import { workspaceConfigDir } from "./workspace";

/**
 * 有限扩展点（AR-16）：项目目录约定的自定义工具 + 生命周期钩子。
 *
 * - 自定义工具：`<ws>/.anycode/tools/*.mjs`，default export：
 *   { name, description, parameters(JSON Schema), execute(args, ctx),
 *     readOnly?, concurrencySafe? }
 *   execute 收真实 ToolContext（权限/快照/jobs 全可用）。加载即注册到工具集，
 *   与内置/已载工具重名 → 跳过 + 告警（不覆盖）。单文件失败跳过不阻断。
 * - 生命周期钩子：`<ws>/.anycode/hooks.mjs` 导出 { beforeToolCall?, afterToolCall? }：
 *   beforeToolCall(tool, args) → void | { deny: reason }（拒绝执行）；
 *   afterToolCall(tool, args, result)。钩子异常不阻断主流程。
 *
 * 与 dsh 的"一切皆插件"和 pi 的 extension 系统有意保持距离：仅两个声明式挂载点，
 * 与权限系统（自定义工具无 meta → 保守 ask）和技能系统互补而非造轮子。
 */

export interface ExtensionHooks {
    beforeToolCall?: (
        tool: string,
        args: Record<string, unknown>
    ) => void | { deny?: string } | Promise<void | { deny?: string }>;
    afterToolCall?: (
        tool: string,
        args: Record<string, unknown>,
        result: string
    ) => void | Promise<void>;
}

export interface WorkspaceExtensions {
    tools: Tool[];
    hooks: ExtensionHooks;
    /** 加载告警（面向用户的 Warning 事件文案） */
    warnings: string[];
}

interface CustomToolDef {
    name?: string;
    description?: string;
    parameters?: unknown;
    readOnly?: boolean;
    concurrencySafe?: boolean;
    execute?: (args: unknown, ctx: unknown) => unknown;
}

/** 工具/钩子目录。 */
function toolsDir(workspace: Workspace): string {
    return path.join(workspaceConfigDir(workspace), "tools");
}
function hooksFile(workspace: Workspace): string {
    return path.join(workspaceConfigDir(workspace), "hooks.mjs");
}

/** 加载项目级扩展（自定义工具 + 钩子）。任何失败都以告警形式降级，不阻断 agent 启动。 */
export async function loadWorkspaceExtensions(
    workspace: Workspace,
    /** 保留名（内置工具名集合）：自定义工具与之重名 → 跳过 + 告警 */
    reservedNames: ReadonlySet<string>
): Promise<WorkspaceExtensions> {
    const warnings: string[] = [];
    const tools: Tool[] = [];
    let hooks: ExtensionHooks = {};

    const dir = toolsDir(workspace);
    if (fs.existsSync(dir)) {
        const files = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".mjs") || f.endsWith(".js"))
            .sort();
        for (const file of files) {
            try {
                const mod = (await import(
                    pathToFileURL(path.join(dir, file)).href
                )) as { default?: CustomToolDef };
                const def = mod.default;
                const name = def?.name;
                if (!name || typeof name !== "string") {
                    warnings.push(`扩展工具 ${file} 缺少 name，已跳过`);
                    continue;
                }
                if (reservedNames.has(name) || tools.some((t) => (t.schema as { function?: { name?: string } }).function?.name === name)) {
                    warnings.push(`扩展工具 ${file} 的 name "${name}" 与已有工具冲突，已跳过`);
                    continue;
                }
                if (typeof def.execute !== "function") {
                    warnings.push(`扩展工具 ${file} 缺少 execute 函数，已跳过`);
                    continue;
                }
                const meta: ToolMeta = {
                    readOnly: def.readOnly === true,
                    concurrencySafe: def.concurrencySafe === true,
                };
                const schema: ChatCompletionTool = {
                    type: "function",
                    function: {
                        name,
                        description: def.description ?? "",
                        parameters: (def.parameters ?? {
                            type: "object",
                            properties: {},
                        }) as never,
                    },
                } as unknown as ChatCompletionTool;
                tools.push({
                    schema,
                    handler: async (args, ctx) => {
                        const out = await def.execute!(args, ctx);
                        if (typeof out === "string") return { content: out };
                        if (
                            out &&
                            typeof out === "object" &&
                            typeof (out as ToolResult).content === "string"
                        ) {
                            return out as ToolResult;
                        }
                        return { content: out == null ? "" : String(out) };
                    },
                    meta,
                });
            } catch (err) {
                warnings.push(
                    `扩展工具 ${file} 加载失败：${err instanceof Error ? err.message : String(err)}`
                );
            }
        }
    }

    const hooksPath = hooksFile(workspace);
    if (fs.existsSync(hooksPath)) {
        try {
            const mod = (await import(
                pathToFileURL(hooksPath).href
            )) as { beforeToolCall?: ExtensionHooks["beforeToolCall"]; afterToolCall?: ExtensionHooks["afterToolCall"] };
            hooks = {
                beforeToolCall: typeof mod.beforeToolCall === "function" ? mod.beforeToolCall : undefined,
                afterToolCall: typeof mod.afterToolCall === "function" ? mod.afterToolCall : undefined,
            };
        } catch (err) {
            warnings.push(
                `hooks.mjs 加载失败：${err instanceof Error ? err.message : String(err)}`
            );
        }
    }

    return { tools, hooks, warnings };
}

/** 钩子调用辅助：beforeToolCall 返回 {deny} 时给出拒绝原因，否则 null。异常视为放行（不阻断）。 */
export async function runBeforeToolHook(
    hooks: ExtensionHooks | undefined,
    tool: string,
    args: Record<string, unknown>
): Promise<string | null> {
    if (!hooks?.beforeToolCall) return null;
    try {
        const r = await hooks.beforeToolCall(tool, args);
        if (r && typeof r === "object" && typeof r.deny === "string") {
            return r.deny;
        }
        return null;
    } catch {
        return null; // 钩子异常不阻断（AR-16：失败不阻断主流程）
    }
}

/** afterToolCall 钩子（fire-and-forget，异常吞掉）。 */
export function runAfterToolHook(
    hooks: ExtensionHooks | undefined,
    tool: string,
    args: Record<string, unknown>,
    result: string
): void {
    if (!hooks?.afterToolCall) return;
    try {
        void Promise.resolve(hooks.afterToolCall(tool, args, result)).catch(() => {});
    } catch {
        // 同步异常吞掉
    }
}
