<script setup lang="ts">
// 中央：展示当前选中工作区的会话列表（或空状态引导选工作区）
import type { SessionMeta } from "@any-code/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const { selected, workspaces, refresh, select } = useWorkspaceState();

// 选中工作区变化时拉它的 sessions
const sessions = ref<SessionMeta[]>([]);
watch(
    () => selected.value?.projectKey,
    async (pk) => {
        if (!pk) {
            sessions.value = [];
            return;
        }
        sessions.value = await $fetch<SessionMeta[]>(
            `/api/workspaces/${pk}/sessions`
        );
    },
    { immediate: true }
);

onMounted(() => {
    if (!workspaces.value.length) refresh();
});

async function newChat() {
    if (!selected.value) return;
    const { id } = await $fetch<{ id: string }>("/api/agents", {
        method: "POST",
        body: { workspacePath: selected.value.rootPath },
    });
    await navigateTo(`/chat/${id}`);
}

async function resume(sessionId: string) {
    if (!selected.value) return;
    const { id } = await $fetch<{ id: string }>("/api/agents", {
        method: "POST",
        body: { workspacePath: selected.value.rootPath, sessionId },
    });
    await navigateTo(`/chat/${id}`);
}
</script>

<template>
    <div class="h-full overflow-y-auto">
        <div
            class="w-full max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6"
        >
            <div class="flex items-center justify-between gap-4">
                <div class="flex flex-col gap-1 min-w-0">
                    <h1 class="text-2xl font-bold text-foreground">
                        {{ selected?.name || "AnyCode Web" }}
                    </h1>
                    <span
                        v-if="selected"
                        class="text-xs text-muted-foreground font-mono truncate"
                    >
                        📁 {{ selected.rootPath }}
                    </span>
                    <span v-else class="text-xs text-muted-foreground">
                        在顶栏「添加工作区」选一个本地目录开始
                    </span>
                </div>
                <Button
                    v-if="selected"
                    class="shrink-0"
                    @click="newChat"
                >
                    ＋ 新建对话
                </Button>
            </div>

            <Card v-if="selected">
                <CardHeader>
                    <CardTitle>会话</CardTitle>
                </CardHeader>
                <CardContent class="flex flex-col gap-1">
                    <button
                        v-for="s in sessions"
                        :key="s.id"
                        class="flex items-center justify-between gap-3 px-2 py-2 rounded-md hover:bg-accent text-left"
                        @click="resume(s.id)"
                    >
                        <span class="text-sm text-accent-foreground truncate">
                            {{ s.title || "（无标题）" }}
                        </span>
                        <span class="text-xs text-muted-foreground whitespace-nowrap">
                            {{ new Date(s.updatedAt).toLocaleString() }}
                        </span>
                    </button>
                    <p
                        v-if="!sessions.length"
                        class="text-sm text-muted-foreground px-2 py-2"
                    >
                        暂无会话，点「新建对话」开始
                    </p>
                </CardContent>
            </Card>
        </div>
    </div>
</template>
