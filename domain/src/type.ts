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
    ASSISTANT = "Assistant",
    PLANNING = "Planning",
    ERROR = "Error",
    DONE = "Done",
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
}
