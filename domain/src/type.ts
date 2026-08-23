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
    ITERATION = "Iteration",
    ASSISTANT_DELTA = "AssistantDelta",
    ASSISTANT = "Assistant",
    USAGE = "Usage",
    PLANNING = "Planning",
    ERROR = "Error",
    DONE = "Done",
    STOPPED = "Stopped",
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
