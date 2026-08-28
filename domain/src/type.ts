import { ChatCompletionMessageParam } from "openai/resources/index";

export type ChatMessage = ChatCompletionMessageParam;

export interface AgentLoopResult {
    result: string;
    messages: ChatMessage[];
}

export enum EventType {
    SYSTEM = "System",
    USER = "User",
    TOOL = "Tool",
    TOOL_START = "ToolStart",
    TOOL_PROGRESS = "ToolProgress",
    TOOL_ARG_PROGRESS = "ToolArgProgress",
    ITERATION = "Iteration",
    ASSISTANT_DELTA = "AssistantDelta",
    ASSISTANT = "Assistant",
    THINKING = "Thinking",
    USAGE = "Usage",
    PLANNING = "Planning",
    COMPACT = "Compact",
    INTERACTION = "Interaction",
    ERROR = "Error",
    WARNING = "Warning",
    DONE = "Done",
    STOPPED = "Stopped",
}

/** durable 事件集：持久化到 session JSONL，作 reload UI 真值（SPEC-030 B-004/I-005）。
 *  ephemeral（AssistantDelta/ToolStart/ToolProgress/ToolArgProgress/System/Planning/Interaction）
 *  live-only 不持久——deltas/progress 是实时 UX，reload 不重建。 */
export const DURABLE_TYPES: ReadonlySet<EventType> = new Set<EventType>([
    EventType.USER,
    EventType.ITERATION,
    EventType.THINKING,
    EventType.ASSISTANT,
    EventType.TOOL,
    EventType.USAGE,
    EventType.COMPACT,
    EventType.ERROR,
    EventType.WARNING,
    EventType.DONE,
    EventType.STOPPED,
]);

/**
 * assistant message 的非标准 sidecar（命名空间化，避免和 provider 的 reasoning_content 字段撞）。
 * reasoning：思考内容全文，随 message 落盘，回放时重建 Thinking 事件（SPEC-017）。
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

export interface AgentEvent {
    timestamp: number;
    type: EventType;
    message: string;
    data?: any;
    /** 发出该事件的 agent 名(主 agent 省略;sub-agent 用 def.name,如 "plan") */
    author?: string;
    /** 一次 sub-agent 调用的分组 id,前端据此折叠展示 */
    runId?: string;
    /** 一次推理回合的分组 id:同一回合的 ITERATION/ASSISTANT_DELTA/ASSISTANT/TOOL 事件共用,
     *  前端据此把 "assistant 文本 + 紧随的工具调用" 组成块状展示 */
    turnId?: string;
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

export interface AgentEventPayload {
    type: EventType;
    message: string;
    data?: any;
    author?: string;
    runId?: string;
    turnId?: string;
}

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
