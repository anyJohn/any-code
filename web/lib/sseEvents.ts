// 前端事件视图：自己定义 AgentEvent 类型，避免把 @any-code/domain 的 Node 运行时拉进客户端。
// 字段对应 domain 的 AgentEvent / EventType。

export interface AgentEvent {
    id: string; // 客户端生成的唯一 key（历史与实时事件混排，timestamp 可能撞）
    timestamp: number;
    type:
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
    message: string;
    data?: unknown;
    author?: string; // sub-agent 名（主 agent 省略）
    runId?: string; // 一次 sub-agent 调用的分组 id
    turnId?: string; // 一次推理回合的分组 id：同回合的 Iteration/Assistant/Tool 共用
}

// USAGE 事件 data 形状（domain EventType.Usage）：每轮 LLM 调用的 token 用量
export interface UsageData {
    prompt_tokens: number;
    completion_tokens: number;
    contextWindow: number;
}

// domain TOOL 事件 data 的形状（见 domain/src/tools/toolCall.ts）
export interface ToolCallData {
    name: string;
    args: Record<string, unknown>;
    result: string;
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

// messagesToEvents / mergeEvents / contentToString 已退役（SPEC-030 B-007）：
// reload 改为重放持久化 durable 事件日志（Chat.tsx initialEvents = data.events），
// 定位 by construction（事件日志有序），不再从 messages 反推 + content-match 定位。
