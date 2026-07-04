<script setup lang="ts">
// 左侧栏：列出所有工作区（Collapsible 展开 sessions）。点工作区 → 中央展示其 sessions；点 session → resume 进聊天。
import type { WorkspaceMeta, SessionMeta } from "@any-code/domain";
import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, MessageSquare, Folder } from "@lucide/vue";

const { selected, workspaces, refresh, select } = useWorkspaceState();

// 每个工作区的 sessions 缓存（按 projectKey）
const sessionsMap = ref<Record<string, SessionMeta[]>>({});
const openKeys = ref<Record<string, boolean>>({});

onMounted(() => {
    refresh();
});

async function loadSessions(w: WorkspaceMeta) {
    sessionsMap.value[w.projectKey] =
        await $fetch<SessionMeta[]>(`/api/workspaces/${w.projectKey}/sessions`);
}

async function onToggle(w: WorkspaceMeta) {
    openKeys.value[w.projectKey] = !openKeys.value[w.projectKey];
    if (openKeys.value[w.projectKey] && !sessionsMap.value[w.projectKey]) {
        await loadSessions(w);
    }
    select(w); // 切换当前工作区
}

async function newChat(w: WorkspaceMeta) {
    const { id } = await $fetch<{ id: string }>("/api/agents", {
        method: "POST",
        body: { workspacePath: w.rootPath },
    });
    await navigateTo(`/chat/${id}`);
}

async function resume(w: WorkspaceMeta, sessionId: string) {
    const { id } = await $fetch<{ id: string }>("/api/agents", {
        method: "POST",
        body: { workspacePath: w.rootPath, sessionId },
    });
    await navigateTo(`/chat/${id}`);
}
</script>

<template>
    <ScrollArea class="h-full">
        <div class="p-2 flex flex-col gap-1">
            <p v-if="!workspaces.length" class="px-2 py-4 text-xs text-muted-foreground">
                顶栏「添加工作区」选一个本地目录开始
            </p>

            <Collapsible
                v-for="w in workspaces"
                :key="w.projectKey"
                :open="openKeys[w.projectKey]"
                @update:open="onToggle(w)"
            >
                <CollapsibleTrigger
                    class="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left"
                    :class="{
                        'bg-accent':
                            selected?.projectKey === w.projectKey,
                    }"
                >
                    <ChevronRight
                        class="size-3.5 transition-transform"
                        :class="{ 'rotate-90': openKeys[w.projectKey] }"
                    />
                    <Folder class="size-3.5 text-muted-foreground" />
                    <span class="truncate">{{ w.name }}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div class="ml-4 my-1 flex flex-col gap-0.5 border-l border-border pl-2">
                        <button
                            class="flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-accent text-left"
                            @click.stop="newChat(w)"
                        >
                            <MessageSquare class="size-3" /> 新建对话
                        </button>
                        <button
                            v-for="s in sessionsMap[w.projectKey] || []"
                            :key="s.id"
                            class="flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-accent text-left truncate"
                            @click.stop="resume(w, s.id)"
                        >
                            <MessageSquare class="size-3 shrink-0 text-muted-foreground" />
                            <span class="truncate">{{ s.title || "（无标题）" }}</span>
                        </button>
                        <p
                            v-if="
                                openKeys[w.projectKey] &&
                                !(sessionsMap[w.projectKey] || []).length
                            "
                            class="px-2 py-1 text-[11px] text-muted-foreground"
                        >
                            暂无会话
                        </p>
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    </ScrollArea>
</template>
