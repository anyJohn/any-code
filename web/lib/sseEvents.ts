// 前端事件视图：自己定义 AgentEvent 类型，避免把 @any-code/domain 的 Node 运行时拉进客户端。
// 字段对应 domain 的 AgentEvent / EventType。

export interface AgentEvent {
    id: string; // 客户端生成的唯一 key（历史与实时事件混排，timestamp 可能撞）
    timestamp: number;
    type:
        | "System"
        | "User"
        | "Tool"
        | "Iteration"
        | "AssistantDelta"
        | "Assistant"
        | "Usage"
        | "Planning"
        | "Error"
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
}

let idCounter = 0;
export const nextId = (prefix: string) => `${prefix}-${idCounter++}`;

/** ChatMessage.content 可能是 string | null | 多模态数组，归一化成文本（TUI 里 contentToString 同款） */
export function contentToString(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part: unknown) =>
                typeof part === "string"
                    ? part
                    : (part as { text?: string })?.text ?? ""
            )
            .join("");
    }
    return "";
}

/**
 * 把持久化的消息按回合重建为事件流，让历史回放与实时 SSE **同形**：
 * assistant 消息开一个新回合（ITERATION + ASSISTANT + 其 tool_calls 对应的 TOOL 事件），
 * role=tool 的结果消息通过 tool_call_id 关联回 assistant 的 tool_calls，并入其回合。
 */
export function messagesToEvents(msgs: HistoryMessage[]): AgentEvent[] {
    const events: AgentEvent[] = [];
    // tool_call_id → 结果文本，供 assistant.tool_calls 查 result
    const toolResultById = new Map<string, string>();
    for (const m of msgs) {
        if (m.role === "tool" && m.tool_call_id) {
            toolResultById.set(m.tool_call_id, contentToString(m.content));
        }
    }
    let turn = 0;
    for (const m of msgs) {
        if (m.role === "user") {
            events.push({
                id: nextId("hist"),
                timestamp: 0,
                type: "User",
                message: contentToString(m.content),
            });
        } else if (m.role === "assistant") {
            const turnId = `hist-turn-${turn++}`;
            events.push({
                id: nextId("hist"),
                timestamp: 0,
                type: "Iteration",
                message: `Iteration ${turn}`,
                turnId,
            });
            const text = contentToString(m.content);
            if (text) {
                events.push({
                    id: nextId("hist"),
                    timestamp: 0,
                    type: "Assistant",
                    message: text,
                    turnId,
                });
            }
            if (m.tool_calls?.length) {
                for (const tc of m.tool_calls) {
                    let args: Record<string, unknown> = {};
                    try {
                        args = JSON.parse(tc.function.arguments || "{}");
                    } catch {
                        // 非法 JSON 留空 args
                    }
                    events.push({
                        id: nextId("hist"),
                        timestamp: 0,
                        type: "Tool",
                        message: tc.function.name,
                        data: {
                            name: tc.function.name,
                            args,
                            result: toolResultById.get(tc.id) ?? "",
                        } satisfies ToolCallData,
                        turnId,
                    });
                }
            }
        }
        // system / tool / unknown 跳过：system 不入盘也不展示；tool 已被 assistant 消费
    }
    return events;
}
