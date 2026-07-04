<script setup lang="ts">
// 聊天页 /chat/:agentId —— 在 layout 内占满 content 区
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AgentEvent } from "@/composables/useAgent";

const route = useRoute();
const agentId = String(route.params.id);

const { events, pending, submit, stop } = useAgent(agentId);
const { select, refresh, workspaces } = useWorkspaceState();

// 拉 agent 元信息，把当前工作区同步到顶栏/侧栏（支持深链直达）
const { data: agentInfo } = await useFetch<{
    workspacePath: string;
    projectKey: string;
}>(`/api/agents/${agentId}`);
onMounted(async () => {
    if (agentInfo.value) {
        if (!workspaces.value.length) await refresh();
        const meta = workspaces.value.find(
            (w) => w.projectKey === agentInfo.value!.projectKey
        );
        if (meta) select(meta);
    }
});

const draft = ref("");
const scrollRef = ref<HTMLElement>();

const tagClass: Record<AgentEvent["type"], string> = {
    System: "text-muted-foreground",
    User: "text-foreground",
    Tool: "text-muted-foreground",
    Iteration: "text-muted-foreground/70",
    Assistant: "text-primary",
    Planning: "text-muted-foreground",
    Error: "text-destructive",
    Done: "text-primary",
};

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
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
        if (isInitial || nearBottom) el.scrollTop = el.scrollHeight;
    }
);
</script>

<template>
    <div class="h-full flex flex-col">
        <div ref="scrollRef" class="flex-1 min-h-0 overflow-y-auto">
            <div class="w-full max-w-3xl mx-auto px-4 py-4 flex flex-col gap-2">
                <div
                    v-for="e in events"
                    :key="e.id"
                    class="flex flex-col gap-1 py-2 border-b border-border/60 last:border-0"
                >
                    <span :class="cn('text-[11px] font-mono uppercase', tagClass[e.type])">
                        {{ e.type }}
                    </span>
                    <span class="text-sm text-foreground whitespace-pre-wrap break-words">
                        {{ e.message }}
                    </span>
                </div>
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
            <Button v-if="pending" variant="destructive" @click="stop">停止</Button>
        </div>
    </div>
</template>
