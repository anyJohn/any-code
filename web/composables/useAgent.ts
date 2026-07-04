import { ref, onMounted, onUnmounted } from "vue";

// 前端自己定义事件视图，避免从 @any-code/domain 拉运行时代码进客户端（domain 含 Node 依赖）。
// 字段对应 domain 的 AgentEvent / EventType。
export interface AgentEvent {
    id: string; // 客户端生成的唯一 key（历史与实时事件混排，timestamp 可能撞）
    timestamp: number;
    type: "System" | "User" | "Tool" | "Iteration" | "Assistant" | "Planning" | "Error" | "Done";
    message: string;
    data?: unknown;
}

// history 端点返回的 ChatMessage 的最小视图
interface HistoryMessage {
    role: string;
    content: unknown;
    tool_calls?: Array<{ function: { name: string; arguments?: string } }>;
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

/** 把持久化的消息映射成展示用事件；system 不入盘也不展示 */
function messageToEvent(msg: HistoryMessage): AgentEvent | null {
    const roleMap: Record<string, AgentEvent["type"]> = {
        user: "User",
        assistant: "Assistant",
        tool: "Tool",
    };
    const type = roleMap[msg.role];
    if (!type) return null; // system / unknown 跳过

    let message = contentToString(msg.content);
    // assistant 带 tool_calls 但 content 为空时，展示调用的工具名（执行结果由 role=tool 消息体现）
    if (type === "Assistant" && !message && msg.tool_calls?.length) {
        const names = msg.tool_calls
            .map((t) => t.function?.name)
            .filter(Boolean)
            .join(", ");
        message = `[调用工具: ${names}]`;
    }
    return { id: nextId("hist"), timestamp: 0, type, message };
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
            // Done / Error 都解除 pending（任务完成或出错）
            if (e.type === "Done" || e.type === "Error") pending.value = false;
        };
        es.onerror = () => {
            pending.value = false; // 连接异常时解除 pending，避免输入框永久锁死
        };
    }

    async function loadHistory() {
        try {
            const msgs = await $fetch<HistoryMessage[]>(`/api/agents/${agentId}/history`);
            for (const m of msgs) {
                const e = messageToEvent(m);
                if (e) events.value.push(e);
            }
        } catch {
            // 新建 agent（首条消息前 session 为 null）或历史为空，忽略
        }
    }

    async function submit(task: string) {
        if (!task.trim() || pending.value) return;
        pending.value = true;
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
