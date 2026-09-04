import type { Workspace } from "./workspace";
import type { AgentEventPayload } from "./type";
import type { LlmProvider } from "./config";
import type { SkillEntry } from "./skill";
import type { PermissionContext } from "./permissions";
import type { Snapshot } from "./snapshot";
import type { JobRegistry } from "./jobs";
import type { ExtensionHooks } from "./extensions";

/** 最小事件发射接口。EventStream 实现它;AgentTool 的 tagged proxy 也实现它。 */
export interface EventEmitter {
    submit(event: AgentEventPayload): void;
}

/**
 * 工具调用上下文：贯穿 agentLoop → toolCall → 各工具。
 * workspace 给文件工具经 resolvePath、bash 设 cwd；eventStream 给工具发事件；
 * signal 用于中断——AnyAgent 持有 AbortController，stop() 时 abort，
 * agentLoop 在迭代边界检查、callLLM 传给 OpenAI 客户端，正在进行的 LLM 调用会抛 AbortError。
 * llm 是当前生效 provider 设置（apiKey/baseURL/model/streaming），由 AnyAgent 从 Config 解析传入。
 * emitProgress：toolCall 每次调用前注入，供流式工具（如 bash）逐 chunk 上抛 TOOL_PROGRESS；
 *   非流式工具忽略。turnId 已由 toolCall 闭包绑定。
 *
 * 主 agent 的 ctx.eventStream 是 AnyAgent 自己的 EventStream；
 * sub-agent 的 ctx.eventStream 是一个 tagged proxy——转发到父流并打 author/runId。
 * sub-agent 共享父的 signal：父被中断时子也一起停。
 */
export interface ToolContext {
    workspace: Workspace;
    eventStream: EventEmitter;
    signal: AbortSignal;
    llm?: LlmProvider;
    emitProgress?: (chunk: string) => void;
    /** path(ms mtime)→上次 read 的 mtime。write/edit 写前对比检测外部改动（警告不阻断）。SPEC-022 B-006 */
    fileState?: Map<string, number>;
    /** Windows agent bash 用的 Git Bash 路径（来自 config.gitBashPath，bash.ts resolveShell 用）。 */
    gitBashPath?: string;
    /** 技能目录合并表（resolveSkills 结果）：skill 工具按 name 取全文。SPEC-031 B-005 */
    skills?: Map<string, SkillEntry>;
    /** 工具权限上下文（SPEC-032）：undefined = 权限系统未启用（直通，测试/兼容路径）。 */
    permissions?: PermissionContext;
    /** 工作区快照钩子（AR-4，异步）：写类工具执行前自动快照；undefined = 未启用（跳过）。 */
    snapshot?: { snapshot(label: string): Promise<Snapshot | null> };
    /** 命名 provider 表（FR-11）：sub-agent 按 def.provider 覆盖 llm 时查此表 */
    providers?: Record<string, import("./config").LlmProvider>;
    /** 当前 sub-agent 委托深度（FR-11）：主 agent 0；AgentTool 内 +1，超 def.maxDepth 拒绝 */
    subagentDepth?: number;
    /** bash 后台任务注册表（FR-13）：undefined = 未启用（bash 后台参数不可用） */
    jobs?: JobRegistry;
    /** 生命周期钩子（AR-16）：before/afterToolCall；undefined = 未启用 */
    hooks?: ExtensionHooks;
    /** AR-23 日志不变式：undefined = 不检查（sub-agent 隔离上下文不传）。
     *  seen = 已确认落盘的消息身份集（main.ts 经 onMessage/compact 标记）；
     *  agentLoop 每次 LLM 调用前断言请求内非 system 消息全部已落盘，破坏发 Warning。 */
    logInvariant?: { seen: WeakSet<object>; warned?: boolean };
    /** 通用工具私有配置（用户决策 2026-09-03）：config.tools.<工具名>.config 经此注入；
     *  工具 handler 按名取（web_search: provider/apiKey；browser_*: cdpUrl…）。undefined = 未配置。 */
    toolsConfig?: Record<string, Record<string, unknown>>;
}
