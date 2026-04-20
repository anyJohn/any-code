import { ChatCompletionMessageParam } from "openai/resources/index";

export type ChatMessage = ChatCompletionMessageParam;

export interface AgentLoopResult {
    result: string;
    messages: ChatMessage[];
}
