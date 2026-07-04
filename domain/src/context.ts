import type { Workspace } from "./workspace";
import type { AgentEventPayload } from "./type";

/** 最小事件发射接口。EventStream 实现它;AgentTool 的 tagged proxy 也实现它。 */
export interface EventEmitter {
    submit(event: AgentEventPayload): void;
}

/**
 * 工具调用上下文：贯穿 agentLoop → toolCall → 各工具。
 * workspace 给文件工具经 resolvePath、bash 设 cwd；eventStream 给工具发事件；
 * signal 用于中断——AnyAgent 持有 AbortController，stop() 时 abort，
 * agentLoop 在迭代边界检查、callLLM 传给 OpenAI 客户端，正在进行的 LLM 调用会抛 AbortError。
 *
 * 主 agent 的 ctx.eventStream 是 AnyAgent 自己的 EventStream；
 * sub-agent 的 ctx.eventStream 是一个 tagged proxy——转发到父流并打 author/runId。
 * sub-agent 共享父的 signal：父被中断时子也一起停。
 */
export interface ToolContext {
    workspace: Workspace;
    eventStream: EventEmitter;
    signal: AbortSignal;
}
