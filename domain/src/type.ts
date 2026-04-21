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
}

export interface AgentEvent {
    timestamp: number;
    type: EventType;
    message: string;
    data?: any;
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
}
