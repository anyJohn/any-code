import { ref, onMounted, onUnmounted } from "vue";

// 前端自己定义事件视图，避免从 @any-code/domain 拉运行时代码进客户端（domain 含 Node 依赖）。
// 字段对应 domain 的 AgentEvent / EventType。
export interface AgentEvent {
    id: string; // 客户端生成的唯一 key（历史与实时事件混排，timestamp 可能撞）
    timestamp: number;
    type: "System" | "User" | "Tool" | "Iteration" | "Assistant" | "Planning" | "Error" | "Done" | "Stopped";
    message: string;
    data?: unknown;
    author?: string; // sub-agent 名（主 agent 省略）
    runId?: string; // 一次 sub-agent 调用的分组 id
    turnId?: string; // 一次推理回合的分组 id：同回合的 Iteration/Assistant/Tool 共用
}

// domain TOOL 事件 data 的形状（见 domain/src/tools/toolCall.ts）
export interface ToolCallData {
    name: string;
    args: Record<string, unknown>;
    result: string;
}

// history 端点返回的 ChatMessage 的最小视图
interface HistoryMessage {
    role: string;
    content: unknown;
    tool_calls?: Array<{
        id: string;
        function: { name: string; arguments?: string };
    }>;
    tool_call_id?: string;
}

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${idCounter++}`;

/** ChatMessage.content 可能是 string | null | 多模态数组，归一化成文本（TUI 里的 contentToString 同款） */
function contentToString(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part: unknown) =>
                typeof part === "string" ? part : (part as { text?: string })?.text ?? ""
            )
            .join("");
    }
    return "";
}

/**
 * 把持久化的消息按回合重建为事件流，让历史回放与实时 SSE **同形**：
 * assistant 消息开一个新回合（ITERATION + ASSISTANT + 其 tool_calls 对应的 TOOL 事件），
 * role=tool 的结果消息通过 tool_call_id 关联回 assistant 的 tool_calls，不再独立成事件。
 */
function messagesToEvents(msgs: HistoryMessage[]): AgentEvent[] {
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

/**
 * useAgent —— 等价 TUI 里 App.tsx 的 initAgent + rxjs 订阅。
 * onMounted 先拉历史（resume 场景回显旧消息），再连 SSE 接增量。
 * EventSource 是浏览器 API，必须放 onMounted（SSR 安全）。
 */
export function useAgent(agentId: string) {
    const events = ref<AgentEvent[]>([]);
    const pending = ref(false);
    let es: EventSource | null = null;

    function connect() {
        es = new EventSource(`/api/agents/${agentId}/events`);
        es.onmessage = (ev) => {
            const e = JSON.parse(ev.data) as Omit<AgentEvent, "id">;
            events.value.push({ ...e, id: nextId("live") }); // ref.value 直接改，Vue 响应式自动追踪
            // Done / Error / Stopped 都解除 pending（任务完成、出错或被中断）
            if (e.type === "Done" || e.type === "Error" || e.type === "Stopped")
                pending.value = false;
        };
        es.onerror = () => {
            pending.value = false; // 连接异常时解除 pending，避免输入框永久锁死
        };
    }

    async function loadHistory() {
        try {
            const msgs = await $fetch<HistoryMessage[]>(`/api/agents/${agentId}/history`);
            for (const e of messagesToEvents(msgs)) {
                events.value.push(e);
            }
        } catch {
            // 新建 agent（首条消息前 session 为 null）或历史为空，忽略
        }
    }

    async function submit(task: string) {
        if (!task.trim() || pending.value) return;
        pending.value = true;
        // 乐观插入用户消息气泡（右对齐）：不等 SSE 往返，立刻显示。
        // domain 不再发 User 事件（避免与历史回放的 User 重复），所以本地补一条。
        events.value.push({
            id: nextId("local"),
            timestamp: Date.now(),
            type: "User",
            message: task,
        });
        try {
            await $fetch(`/api/agents/${agentId}/messages`, {
                method: "POST",
                body: { task },
            });
        } catch (err) {
            pending.value = false;
            events.value.push({
                id: nextId("local"),
                timestamp: Date.now(),
                type: "Error",
                message: `提交失败: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    }

    function stop() {
        $fetch(`/api/agents/${agentId}/stop`, { method: "POST" });
    }

    onMounted(async () => {
        await loadHistory();
        connect();
    });
    onUnmounted(() => es?.close()); // = ngOnDestroy

    return { events, pending, submit, stop };
}
