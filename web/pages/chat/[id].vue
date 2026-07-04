<script setup lang="ts">
// 聊天页 /chat/:agentId —— 在 layout 内占满 content 区
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { AgentEvent, ToolCallData } from "@/composables/useAgent";

const route = useRoute();
const agentId = String(route.params.id);

const { events, pending, submit, stop } = useAgent(agentId);
const { select, refresh, workspaces, setActiveSession } = useWorkspaceState();

// 拉 agent 元信息，把当前工作区 + 会话同步到顶栏/侧栏（支持深链直达）
const { data: agentInfo } = await useFetch<{
    workspacePath: string;
    projectKey: string;
    sessionId: string | null;
}>(`/api/agents/${agentId}`);
onMounted(async () => {
    if (agentInfo.value) {
        if (!workspaces.value.length) await refresh();
        const meta = workspaces.value.find(
            (w) => w.projectKey === agentInfo.value!.projectKey
        );
        if (meta) select(meta);
        setActiveSession(agentInfo.value.sessionId); // 高亮侧栏对应会话
    }
});

const draft = ref("");
const scrollRef = ref<HTMLElement>();

const tagClass: Record<AgentEvent["type"], string> = {
    System: "text-muted-foreground",
    User: "text-primary-foreground",
    Tool: "text-muted-foreground",
    Iteration: "text-muted-foreground/70",
    Assistant: "text-primary",
    Planning: "text-muted-foreground",
    Error: "text-destructive",
    Done: "text-muted-foreground",
    Stopped: "text-muted-foreground",
};

// 渲染项：回合块 / sub-agent 分组 / 单事件
interface TurnItem {
    kind: "turn";
    turnId: string;
    iteration?: AgentEvent;
    assistant?: AgentEvent;
    tools: AgentEvent[];
}
interface SubagentItem {
    kind: "subagent";
    runId: string;
    author: string;
    events: AgentEvent[];
}
interface SingleItem {
    kind: "single";
    event: AgentEvent;
}
type RenderItem = TurnItem | SubagentItem | SingleItem;

/**
 * 把一段事件流按回合分组：ITERATION 开新回合，ASSISTANT/TOOL 入当前回合，
 * System/User/Done/Error 单条。sub-agent（带 runId）事件不在此处理——
 * 调用方先按 runId 切出 sub-agent 段，再对主流 / sub-agent 内部各自调本函数。
 */
function groupByTurn(events: AgentEvent[]): TurnItem[] {
    const items: TurnItem[] = [];
    let cur: TurnItem | null = null;
    const flush = () => {
        if (cur && (cur.assistant || cur.tools.length || cur.iteration)) {
            items.push(cur);
        }
        cur = null;
    };
    for (const e of events) {
        if (e.type === "Iteration") {
            flush();
            cur = { kind: "turn", turnId: e.turnId ?? "", iteration: e, tools: [] };
        } else if (e.type === "Assistant") {
            if (cur && !cur.assistant && !cur.tools.length) {
                cur.assistant = e;
            } else {
                flush();
                cur = { kind: "turn", turnId: e.turnId ?? "", assistant: e, tools: [] };
            }
        } else if (e.type === "Tool") {
            if (!cur) cur = { kind: "turn", turnId: e.turnId ?? "", tools: [] };
            cur.tools.push(e);
        } else {
            // System/User/Done/Error/Planning 不属于任何回合，跳过（由外层单条渲染）
            flush();
        }
    }
    flush();
    return items;
}

/**
 * 把扁平 events 切成渲染项：主流按回合块、sub-agent 按 runId 成块、其余单条。
 * sub-agent 事件穿插在父回合中间时，会打断父回合——可接受：sub-agent 块自然
 * 落在父回合的 assistant 文本与 tool 结果之间。
 */
function toRenderItems(events: AgentEvent[]): RenderItem[] {
    const items: RenderItem[] = [];
    let mainBuf: AgentEvent[] = [];
    let sub: { runId: string; author: string; events: AgentEvent[] } | null = null;
    const flushMain = () => {
        for (const t of groupByTurn(mainBuf)) items.push(t);
        mainBuf = [];
    };
    const flushSub = () => {
        if (sub) {
            items.push({ kind: "subagent", runId: sub.runId, author: sub.author, events: sub.events });
        }
        sub = null;
    };
    for (const e of events) {
        if (e.runId) {
            flushMain();
            if (sub && sub.runId === e.runId) {
                sub.events.push(e);
            } else {
                flushSub();
                sub = { runId: e.runId, author: e.author ?? "sub-agent", events: [e] };
            }
        } else if (
            e.type === "System" ||
            e.type === "User" ||
            e.type === "Done" ||
            e.type === "Stopped" ||
            e.type === "Error"
        ) {
            flushMain();
            flushSub();
            items.push({ kind: "single", event: e });
        } else {
            flushSub();
            mainBuf.push(e);
        }
    }
    flushMain();
    flushSub();
    return items;
}

const renderItems = computed<RenderItem[]>(() => toRenderItems(events.value));

// 每个 tool 折叠条 / sub-agent 块的展开状态（按 id / runId）
const openTools = ref<Record<string, boolean>>({});
const openSubs = ref<Record<string, boolean>>({});

/** 工具调用摘要：按工具名挑最相关参数（参数字段名见 domain/src/tools/schema.ts） */
function formatToolCall(data: unknown): string {
    const d = data as ToolCallData | undefined;
    if (!d) return "?";
    const a = d.args ?? {};
    const arg = (k: string): string => (typeof a[k] === "string" ? String(a[k]) : "");
    switch (d.name) {
        case "bash":
            return `bash ${arg("command") || ""}`.trim();
        case "read":
        case "write":
            return `${d.name} ${arg("filePath") || ""}`.trim();
        case "edit": {
            const fp = arg("filePath");
            const old = arg("oldString");
            const oldBrief = old ? old.split("\n")[0].slice(0, 40) : "";
            return `edit ${fp}${oldBrief ? `  «${oldBrief}»` : ""}`.trim();
        }
        case "glob":
            return `glob "${arg("pattern")}"${arg("path") ? ` @ ${arg("path")}` : ""}`.trim();
        case "grep":
            return `grep "${arg("pattern")}"${arg("path") ? ` @ ${arg("path")}` : ""}`.trim();
        case "explore":
            return `explore ${arg("directoryPath") || ""}`.trim();
        case "plan":
            return `plan ${arg("task") || ""}`.trim();
        default:
            return d.name;
    }
}

function toolResult(data: unknown): string {
    return (data as ToolCallData | undefined)?.result ?? "";
}

function send() {
    const task = draft.value;
    draft.value = "";
    submit(task);
}

// 新消息自动滚到底；用户上滑阅读时不打断；首次历史灌入强制滚到底
watch(
    () => events.value.length,
    async (_n, oldLen) => {
        await nextTick();
        const el = scrollRef.value;
        if (!el) return;
        const isInitial = !oldLen;
        const nearBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 200;
        if (isInitial || nearBottom) el.scrollTop = el.scrollHeight;
    }
);
</script>

<template>
    <div class="h-full flex flex-col">
        <div ref="scrollRef" class="flex-1 min-h-0 overflow-y-auto">
            <div class="w-full max-w-3xl mx-auto px-4 py-4 flex flex-col gap-2">
                <template v-for="item in renderItems" :key="item.kind === 'turn' ? `turn-${item.turnId}` : item.kind === 'subagent' ? `sub-${item.runId}` : `ev-${(item as any).event.id}`">
                    <!-- 回合块：assistant 文本 + 紧随的工具调用 -->
                    <div
                        v-if="item.kind === 'turn'"
                        class="flex flex-col gap-2 py-3 border-b border-border/60"
                    >
                        <span
                            v-if="item.iteration"
                            class="text-[10px] font-mono text-muted-foreground/60"
                        >
                            {{ item.iteration.message }}
                        </span>
                        <MarkdownRenderer
                            v-if="item.assistant"
                            :content="item.assistant.message"
                        />                        <div
                            v-for="t in item.tools"
                            :key="t.id"
                            class="ml-1"
                        >
                            <Collapsible v-model:open="openTools[t.id]">
                                <CollapsibleTrigger
                                    class="flex items-center gap-1 w-full text-left rounded px-1.5 py-1 hover:bg-muted/50"
                                >
                                    <span class="text-[11px] font-mono text-muted-foreground">
                                        {{ openTools[t.id] ? "▾" : "▸" }}
                                    </span>
                                    <span class="text-[11px] font-mono text-muted-foreground truncate">
                                        {{ formatToolCall(t.data) }}
                                    </span>
                                </CollapsibleTrigger>
                                <CollapsibleContent class="mt-1 ml-4 border-l border-border pl-3">
                                    <pre class="text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-80 overflow-y-auto">{{ toolResult(t.data) }}</pre>
                                </CollapsibleContent>
                            </Collapsible>
                        </div>
                    </div>

                    <!-- sub-agent 分组：折叠块，内部复用回合分块 -->
                    <Collapsible
                        v-else-if="item.kind === 'subagent'"
                        v-model:open="openSubs[item.runId]"
                        class="border-b border-border/60 py-2"
                    >
                        <CollapsibleTrigger
                            class="flex items-center gap-2 w-full text-left rounded px-1.5 py-1 hover:bg-muted/50"
                        >
                            <span class="text-[11px] font-mono text-muted-foreground">
                                {{ openSubs[item.runId] ? "▾" : "▸" }}
                            </span>
                            <span class="text-[11px] font-mono uppercase text-muted-foreground">
                                {{ item.author }}
                            </span>
                            <span class="text-[11px] text-muted-foreground/70">
                                sub-agent · {{ item.events.length }} events
                            </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent class="mt-2 ml-3 flex flex-col gap-2 border-l border-border pl-3">
                            <template v-for="(turn, ti) in groupByTurn(item.events)" :key="`sub-${item.runId}-${ti}`">
                                <div class="flex flex-col gap-1.5">
                                    <span
                                        v-if="turn.iteration"
                                        class="text-[10px] font-mono text-muted-foreground/60"
                                    >
                                        {{ turn.iteration.message }}
                                    </span>
                                    <MarkdownRenderer
                                        v-if="turn.assistant"
                                        :content="turn.assistant.message"
                                    />
                                    <div
                                        v-for="t in turn.tools"
                                        :key="t.id"
                                    >
                                        <Collapsible v-model:open="openTools[t.id]">
                                            <CollapsibleTrigger
                                                class="flex items-center gap-1 w-full text-left rounded px-1 py-0.5 hover:bg-muted/50"
                                            >
                                                <span class="text-[10px] font-mono text-muted-foreground">
                                                    {{ openTools[t.id] ? "▾" : "▸" }}
                                                </span>
                                                <span class="text-[10px] font-mono text-muted-foreground truncate">
                                                    {{ formatToolCall(t.data) }}
                                                </span>
                                            </CollapsibleTrigger>
                                            <CollapsibleContent class="mt-1 ml-4 border-l border-border pl-3">
                                                <pre class="text-[11px] text-muted-foreground whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{{ toolResult(t.data) }}</pre>
                                            </CollapsibleContent>
                                        </Collapsible>
                                    </div>
                                </div>
                            </template>
                        </CollapsibleContent>
                    </Collapsible>

                    <!-- 用户消息：右对齐气泡 -->
                    <div
                        v-else-if="item.kind === 'single' && item.event.type === 'User'"
                        class="flex justify-end py-2"
                    >
                        <div
                            class="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground whitespace-pre-wrap break-words"
                        >
                            {{ item.event.message }}
                        </div>
                    </div>

                    <!-- 终态标记：Done / Stopped 居中小字 -->
                    <div
                        v-else-if="item.kind === 'single' && (item.event.type === 'Done' || item.event.type === 'Stopped')"
                        class="flex justify-center py-2"
                    >
                        <span
                            :class="cn(
                                'text-[11px] italic',
                                item.event.type === 'Stopped' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/70'
                            )"
                        >
                            {{ item.event.message }}
                        </span>
                    </div>

                    <!-- 其它单事件：System / Error -->
                    <div
                        v-else
                        class="flex flex-col gap-1 py-2 border-b border-border/60 last:border-0"
                    >
                        <span :class="cn('text-[11px] font-mono uppercase', tagClass[item.event.type])">
                            {{ item.event.type }}
                        </span>
                        <span class="text-sm text-foreground whitespace-pre-wrap break-words">
                            {{ item.event.message }}
                        </span>
                    </div>
                </template>

                <p
                    v-if="!events.length"
                    class="text-sm text-muted-foreground py-4 text-center"
                >
                    发送一条消息开始对话
                </p>
            </div>
        </div>

        <div
            class="shrink-0 w-full max-w-3xl mx-auto px-4 py-3 border-t border-border bg-background flex gap-2"
        >
            <Input
                v-model="draft"
                :disabled="pending"
                placeholder="输入任务... (Enter 发送)"
                @keyup.enter="send"
            />
            <Button v-if="!pending" @click="send">发送</Button>
            <Button v-else variant="destructive" @click="stop">停止</Button>
        </div>
    </div>
</template>
