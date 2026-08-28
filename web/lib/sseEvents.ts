// 前端事件视图：镜像 domain 的 EventType + per-variant data 形状（SPEC-030 AC-012）。
// 用 flat interface（data 为 typed union，非 unknown；Error/Warning 经 error 字段）——
// 不用 discriminated union：web 经 {...e, id} spread 注入 id，discriminated union 的 spread
// 会丢失 variant 判别，摩擦过大；flat + typed-data 在零消费端 churn 下满足"无 data?:unknown"。

export type EventType =
    | "System"
    | "User"
    | "Tool"
    | "ToolStart"
    | "ToolProgress"
    | "ToolArgProgress"
    | "Iteration"
    | "AssistantDelta"
    | "Assistant"
    | "Thinking"
    | "Usage"
    | "Planning"
    | "Compact"
    | "Interaction"
    | "Error"
    | "Warning"
    | "Done"
    | "Stopped";

export interface AgentEvent {
    id: string; // 客户端生成的唯一 key（历史与实时事件混排，timestamp 可能撞）
    timestamp: number;
    type: EventType;
    message: string;
    /** per-variant data（typed union，非 unknown）。Error/Warning 用 error 字段，不放 data。 */
    data?:
        | ToolCallData
        | UsageData
        | CompactData
        | InteractionData
        | ToolStartData
        | ToolArgProgressData;
    /** Error/Warning 事件的可序列化错误结构（镜像 domain ErrorPayload）。 */
    error?: ErrorPayload;
    turnId?: string;
    author?: string;
    runId?: string;
}

/** SSE/payload：AgentEvent 去掉 id（flat interface，Omit 直接可用）。 */
export type AgentEventPayload = Omit<AgentEvent, "id">;

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
    /** assistant message 的非标准 sidecar（SPEC-017）：reasoning（durable Thinking 事件已持久，不再需从 message 重建） */
    _meta?: { reasoning?: string };
}

let idCounter = 0;
export const nextId = (prefix: string) => `${prefix}-${idCounter++}`;
