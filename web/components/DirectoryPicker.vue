<script setup lang="ts">
// 服务端目录浏览器（浏览器原生 dialog 拿不到绝对路径，只能服务端读 fs）
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronUp, Folder, Check } from "@lucide/vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
    (e: "update:open", v: boolean): void;
    (e: "picked", path: string): void;
}>();

interface BrowseResult {
    current: string;
    parent: string | null;
    dirs: { name: string; path: string }[];
}
const current = ref("");
const parent = ref<string | null>(null);
const dirs = ref<BrowseResult["dirs"]>([]);
const loading = ref(false);
const error = ref("");

async function browse(dir?: string) {
    loading.value = true;
    error.value = "";
    try {
        const r = await $fetch<BrowseResult>("/api/fs/browse", {
            params: dir ? { dir } : {},
        });
        current.value = r.current;
        parent.value = r.parent;
        dirs.value = r.dirs;
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
}

// 打开时初始化到家目录
watch(
    () => props.open,
    (o) => {
        if (o && !current.value) browse();
    }
);

function goUp() {
    if (parent.value) browse(parent.value);
}
function enter(p: string) {
    browse(p);
}
function confirm() {
    if (current.value) {
        emit("picked", current.value);
        emit("update:open", false);
    }
}
</script>

<template>
    <Dialog :open="props.open" @update:open="(v) => emit('update:open', v)">
        <DialogContent class="max-w-lg">
            <DialogHeader>
                <DialogTitle>选择工作区目录</DialogTitle>
            </DialogHeader>

            <div class="flex items-center gap-2 mb-2">
                <Button
                    variant="outline"
                    size="sm"
                    :disabled="!parent"
                    @click="goUp"
                >
                    <ChevronUp class="size-4" /> 上级
                </Button>
                <span class="text-xs text-muted-foreground font-mono truncate flex-1">
                    {{ current }}
                </span>
            </div>

            <ScrollArea class="h-72 rounded-md border">
                <div v-if="error" class="p-3 text-sm text-destructive">{{ error }}</div>
                <div v-else-if="loading" class="p-3 text-sm text-muted-foreground">加载中…</div>
                <div v-else-if="!dirs.length" class="p-3 text-sm text-muted-foreground">
                    无子目录
                </div>
                <button
                    v-for="d in dirs"
                    :key="d.path"
                    class="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    @click="enter(d.path)"
                >
                    <Folder class="size-4 text-muted-foreground" />
                    <span class="truncate">{{ d.name }}</span>
                </button>
            </ScrollArea>

            <DialogFooter>
                <Button variant="outline" @click="emit('update:open', false)">取消</Button>
                <Button @click="confirm">
                    <Check class="size-4" /> 选定此目录
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
