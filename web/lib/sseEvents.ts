// 前端事件视图：镜像 domain 的 AgentEvent discriminated union（SPEC-030 AC-012，full）。
// 加客户端 id（SSE 无 id，前端 nextId 补）。data/error 均 typed per-variant（无 data?:unknown）。
// spread 注入 id 处用 `as AgentEvent`（discriminated union 的 spread 丢判别，cast 还原）。

interface EventBase {
    id: string;
    timestamp: number;
    message: string;
    turnId?: string;
    author?: string;
    runId?: string;
}

export type AgentEvent =
    | (EventBase & { type: "System" })
    | (EventBase & { type: "User" })
    | (EventBase & { type: "Iteration" })
    | (EventBase & { type: "Thinking" })
    | (EventBase & { type: "Assistant" })
    | (EventBase & { type: "AssistantDelta" })
    | (EventBase & { type: "Tool"; data: ToolCallData })
    | (EventBase & { type: "ToolStart"; data: ToolStartData })
    | (EventBase & { type: "ToolProgress" })
    | (EventBase & { type: "ToolArgProgress"; data: ToolArgProgressData })
    | (EventBase & { type: "Usage"; data: UsageData })
    | (EventBase & { type: "Compact"; data: CompactData })
    | (EventBase & { type: "Interaction"; data: InteractionData })
    | (EventBase & { type: "Planning"; data: PlanningEventData })
    | (EventBase & { type: "Permission"; data: PermissionEventData })
    | (EventBase & { type: "PermissionAsk"; data: PermissionAskData })
    | (EventBase & { type: "Error"; error: ErrorPayload })
    | (EventBase & { type: "Warning"; error?: ErrorPayload })
    | (EventBase & { type: "Done" })
    | (EventBase & { type: "Stopped" });

/** SSE/payload：AgentEvent 去掉 id（distributive Omit，保 variant data/error）。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends T
    ? Omit<T, K>
    : never;
export type AgentEventPayload = DistributiveOmit<AgentEvent, "id">;

// ── per-variant data 形状（镜像 domain type.ts）──

export interface UsageData {
    prompt_tokens: number;
    completion_tokens: number;
    contextWindow: number;
}
export interface ToolCallData {
    name: string;
    args: Record<string, unknown>;
    result: string;
    /** 结构化元数据（FR-10）：exitCode/spillFile/filePath 等，UI/系统消费 */
    meta?: Record<string, unknown>;
}
export interface ToolStartData {
    name: string;
    args: unknown;
}
export interface ToolArgProgressData {
    bytes: number;
    name?: string;
}
export interface CompactData {
    beforeTokens: number;
    afterTokens: number;
    auto: boolean;
    focus?: string | null;
}
/** plan 模式计划（FR-12，durable）。镜像 domain PlanningEventData。 */
export interface PlanningEventData {
    plan: string;
    round: number;
}
export interface InteractionQuestion {
    question: string;
    header?: string;
    options?: string[];
    multiSelect?: boolean;
}
export interface InteractionData {
    id: string;
    questions: InteractionQuestion[];
}
/** 权限审计（durable，回放可见）。镜像 domain PermissionEventData。 */
export interface PermissionEventData {
    tool: string;
    pattern?: string;
    source: "rule" | "baseline" | "mode";
    action: "allow" | "ask" | "deny";
    phase: "asked" | "decided";
    decision?: "allow_once" | "allow_always" | "deny" | "timeout";
    scope?: "project" | "global";
    summary?: string;
}
/** 权限裁决请求（live-only，驱动 PermissionModal）。镜像 domain PermissionAskData。 */
export interface PermissionAskData {
    id: string;
    tool: string;
    pattern?: string;
    summary?: string;
    danger?: boolean;
}
export interface ErrorPayload {
    message: string;
    name: string;
    stack?: string;
    cause?: string;
}

// history 端点返回的 ChatMessage 的最小视图
export interface HistoryMessage {
    role: string;
    content: unknown;
    tool_calls?: Array<{
        id: string;
        function: { name: string; arguments?: string };
    }>;
    tool_call_id?: string;
    _meta?: { reasoning?: string };
}

let idCounter = 0;
export const nextId = (prefix: string) => `${prefix}-${idCounter++}`;
