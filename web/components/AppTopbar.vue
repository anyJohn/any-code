<script setup lang="ts">
// 顶栏：当前工作区名 + 下拉（切换最近、添加工作区）。VS Code 式动作区。
import type { WorkspaceMeta } from "@any-code/domain";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDown, Plus, FolderOpen } from "@lucide/vue";

const { selected, workspaces, refresh, select } = useWorkspaceState();
const pickerOpen = ref(false);

onMounted(() => {
    refresh();
});

async function onPicked(path: string) {
    const meta = await $fetch<WorkspaceMeta>("/api/workspaces", {
        method: "POST",
        body: { path },
    });
    await refresh();
    select(meta);
}

function switchTo(meta: WorkspaceMeta) {
    select(meta);
}
</script>

<template>
    <div class="flex items-center gap-3 px-4 h-12">
        <DropdownMenu>
            <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="sm" class="gap-2">
                    <FolderOpen class="size-4" />
                    <span class="truncate max-w-[200px]">
                        {{ selected?.name || "选择工作区" }}
                    </span>
                    <ChevronsUpDown class="size-3 text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-64">
                <DropdownMenuLabel>最近工作区</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div v-if="!workspaces.length" class="px-2 py-3 text-xs text-muted-foreground">
                    尚未添加任何工作区
                </div>
                <DropdownMenuItem
                    v-for="w in workspaces"
                    :key="w.projectKey"
                    class="flex flex-col items-start gap-0.5"
                    @select="switchTo(w)"
                >
                    <span class="text-sm">{{ w.name }}</span>
                    <span class="text-[11px] text-muted-foreground font-mono truncate w-full">
                        {{ w.rootPath }}
                    </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem @select="pickerOpen = true">
                    <Plus class="size-4" /> 添加工作区
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>

        <span v-if="selected" class="text-xs text-muted-foreground font-mono truncate">
            {{ selected.rootPath }}
        </span>
    </div>

    <DirectoryPicker v-model:open="pickerOpen" @picked="onPicked" />
</template>
