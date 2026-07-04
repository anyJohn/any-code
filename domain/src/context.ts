import type { Workspace } from "./workspace";
import type { AgentEventPayload } from "./type";

/** 最小事件发射接口。EventStream 实现它;AgentTool 的 tagged proxy 也实现它。 */
export interface EventEmitter {
    submit(event: AgentEventPayload): void;
}

/**
 * 工具调用上下文：贯穿 agentLoop → toolCall → 各工具。
 * workspace 给文件工具经 resolvePath、bash 设 cwd；eventStream 给工具发事件。
 * 主 agent 的 ctx.eventStream 是 AnyAgent 自己的 EventStream；
 * sub-agent 的 ctx.eventStream 是一个 tagged proxy——转发到父流并打 author/runId。
 */
export interface ToolContext {
    workspace: Workspace;
    eventStream: EventEmitter;
}
