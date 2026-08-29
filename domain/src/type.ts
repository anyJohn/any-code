import { ChatCompletionMessageParam } from "openai/resources/index";

export type ChatMessage = ChatCompletionMessageParam;

export interface AgentLoopResult {
    result: string;
    messages: ChatMessage[];
}

// ── 事件类型（SPEC-030 B-001：discriminated union，per-variant typed payload，删 data?:any）──

/** 事件公共字段。timestamp 由 EventStream.submit 盖；message 所有事件都有。 */
interface EventBase {
    timestamp: number;
    message: string;
    /** 一次推理回合的分组 id：同回合的 Iteration/Assistant/Tool 等共用 */
    turnId?: string;
    /** 发出该事件的 agent 名（主 agent 省略；sub-agent 用 def.name，如 "plan"） */
    author?: string;
    /** 一次 sub-agent 调用的分组 id，前端据此折叠展示 */
    runId?: string;
}

export type AgentEvent =
    | (EventBase & { type: "System" })
    | (EventBase & { type: "User" })
    | (EventBase & { type: "Iteration" })
    | (EventBase & { type: "Thinking" })
    | (EventBase & { type: "Assistant" })
    | (EventBase & { type: "AssistantDelta" })
    | (EventBase & { type: "Tool"; data: ToolEventData })
    | (EventBase & { type: "ToolStart"; data: ToolStartData })
    | (EventBase & { type: "ToolProgress" })
    | (EventBase & { type: "ToolArgProgress"; data: ToolArgProgressData })
    | (EventBase & { type: "Usage"; data: UsageEventData })
    | (EventBase & { type: "Compact"; data: CompactEventData })
    | (EventBase & { type: "Interaction"; data: InteractionEventData })
    | (EventBase & { type: "Planning" })
    | (EventBase & { type: "Error"; error: ErrorPayload })
    | (EventBase & { type: "Warning"; error?: ErrorPayload })
    | (EventBase & { type: "Done" })
    | (EventBase & { type: "Stopped" });

/** 事件类型字面量集合（向后兼容 EventType 引用，但值为 string literal，不再是 enum）。 */
export type EventType = AgentEvent["type"];

// ── per-variant data 形状（均 plain 可序列化，live==persisted by construction）──

export interface ToolEventData {
    name: string;
    args: unknown;
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
export interface UsageEventData {
    prompt_tokens: number;
    completion_tokens: number;
    contextWindow: number;
}
export interface CompactEventData {
    beforeTokens: number;
    afterTokens: number;
    auto: boolean;
    focus?: string | null;
}
export interface InteractionEventData {
    id: string;
    questions: Array<{
        question: string;
        header?: string;
        options?: string[];
        multiSelect?: boolean;
    }>;
}

/** durable 事件集：持久化到 session JSONL，作 reload UI 真值（SPEC-030 B-004/I-005）。
 *  ephemeral（AssistantDelta/ToolStart/ToolProgress/ToolArgProgress/System/Planning/Interaction）
 *  live-only 不持久——deltas/progress 是实时 UX，reload 不重建。 */
export const DURABLE_TYPES: ReadonlySet<EventType> = new Set<EventType>([
    "User",
    "Iteration",
    "Thinking",
    "Assistant",
    "Tool",
    "Usage",
    "Compact",
    "Error",
    "Warning",
    "Done",
    "Stopped",
]);

/**
 * assistant message 的非标准 sidecar（命名空间化，避免和 provider 的 reasoning_content 字段撞）。
 * reasoning：思考内容全文，随 message 落盘；durable Thinking 事件已持久（SPEC-030 P2），不再需从 message 重建。
 * callLLM 入口剥离 _meta，发给 provider 的 messages 不含此字段。
 */
export interface MessageMeta {
    reasoning?: string;
}

/** LLM API 响应里的 token 用量（OpenAI 兼容 shape） */
export interface LlmUsage {
    prompt_tokens: number;
    completion_tokens: number;
}

export enum AgentStatus {
    IDLE = "idle",
    RUNNING = "running",
    COMPLETED = "completed",
    ERROR = "error",
}
export interface InteractionRequest {
    type: string;
    payload?: any;
}

/** submit 入参：AgentEvent 去掉 timestamp（submit 盖 timestamp）。
 *  distributive Omit——对 discriminated union 逐成员去 timestamp，保留各 variant 的 data/error。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends T
    ? Omit<T, K>
    : never;
export type AgentEventPayload = DistributiveOmit<AgentEvent, "timestamp">;

/**
 * 可序列化的错误结构。Error 实例的 message/stack/name 不可枚举（JSON.stringify(err)={}），
 * domain 在发出 Error/Warning 事件时即用它转成 plain object——live==persisted by construction，
 * adapter 不再做 replacer（SPEC-030 B-002 / I-001）。
 */
export interface ErrorPayload {
    message: string;
    name: string;
    stack?: string;
    cause?: string;
}

/** 把任意 thrown 值转成可序列化 ErrorPayload。Error 提取 message/name/stack/cause；其余取 String。 */
export function serializeError(err: unknown): ErrorPayload {
    if (err instanceof Error) {
        const payload: ErrorPayload = { message: err.message, name: err.name };
        if (err.stack) payload.stack = err.stack;
        if (err.cause) payload.cause = String(err.cause);
        return payload;
    }
    return { message: String(err), name: "Error" };
}
