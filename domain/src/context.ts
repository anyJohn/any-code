import type { Workspace } from "./workspace";
import type { AgentEventPayload } from "./type";
import type { LlmProvider } from "./config";
import type { SkillEntry } from "./skill";
import type { PermissionContext } from "./permissions";
import type { Snapshot } from "./snapshot";

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
    /** 工作区快照钩子（AR-4）：写类工具执行前自动快照；undefined = 未启用（跳过）。 */
    snapshot?: { snapshot(label: string): Snapshot | null };
}
