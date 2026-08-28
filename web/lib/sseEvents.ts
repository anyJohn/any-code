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
    /** assistant message 的非标准 sidecar（SPEC-017）：reasoning 用于回放重建 Thinking 事件 */
    _meta?: { reasoning?: string };
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
            // 思考内容落盘回放重建：assistant 带 _meta.reasoning → 产 Thinking 事件（同 turnId），
            // groupByTurn 累积进 TurnItem.thinking → ThinkingBlock 渲染（SPEC-017 B-005）
            if (m._meta?.reasoning) {
                events.push({
                    id: nextId("hist"),
                    timestamp: 0,
                    type: "Thinking",
                    message: m._meta.reasoning,
                    turnId,
                });
            }
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

/** Error 事件 message 的固定前缀（domain main.ts catchError: `Error executing task: ${task}`）。
 *  task 即触发它的用户消息原文（core.ts:28-29 user 消息 content=task）。据此把 error 定位
 *  到对应 User 之后；格式若变则匹配失败、退回末尾追加（降级而非出错）。 */
const ERROR_TASK_PREFIX = "Error executing task: ";

/**
 * 把持久化事件（Error 等消息无法重建的）并入 messagesToEvents 重建流。
 * messages 无时间戳（messagesToEvents 全 stamp timestamp:0），无法按时间与事件交错。
 * 退而求其次用内容锚定：Error 的 message 含触发它的用户消息原文，据此把 error 插到
 * 对应 User 之后——对"崩溃后重试成功"等有后续内容的场景位置正确；匹配不到则末尾追加。
 */
export function mergeEvents(
    messageEvents: AgentEvent[],
    persisted: Omit<AgentEvent, "id">[]
): AgentEvent[] {
    if (persisted.length === 0) return messageEvents;
    // 抽出每个 error 触发的用户消息原文；非 error / 前缀不符 → undefined（末尾追加）
    const pending = persisted.map((e) => {
        const task =
            e.type === "Error" &&
            typeof e.message === "string" &&
            e.message.startsWith(ERROR_TASK_PREFIX)
                ? e.message.slice(ERROR_TASK_PREFIX.length)
                : undefined;
        return { ev: { ...e, id: nextId("hist") } as AgentEvent, task };
    });
    const result: AgentEvent[] = [];
    for (const m of messageEvents) {
        result.push(m);
        if (m.type !== "User") continue;
        // 认领第一条匹配此 user 的 error（每条 user 消息至多对应一个 error）
        const idx = pending.findIndex(
            (p) => p.task != null && p.task === m.message
        );
        if (idx >= 0) {
            result.push(pending[idx].ev);
            pending.splice(idx, 1);
        }
    }
    // 未匹配（抽不出 task / 找不到对应 user）退回末尾追加，保持原顺序
    for (const p of pending) result.push(p.ev);
    return result;
}
