export enum MessageType {
    SYSTEM = "System",
    USER = "User",
    TOOL = "Tool",
    ITERATION = "Iteration",
    ASSISTANT = "Assistant",
    PLANNING = "Planning",
    ERROR = "Error",
}

export interface Message {
    id: string;
    type: MessageType;
    content: string;
    timestamp: number;
}

export interface AgentConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}
