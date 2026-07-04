<script setup lang="ts">
// 默认布局：左 sidebar + 右 main(topbar + content)。VS Code 式。
</script>

<template>
    <div class="h-screen flex">
        <aside class="w-64 shrink-0 border-r border-border bg-background">
            <AppSidebar />
        </aside>
        <div class="flex-1 flex flex-col min-w-0">
            <header class="shrink-0 border-b border-border bg-background">
                <AppTopbar />
            </header>
            <main class="flex-1 min-h-0 overflow-hidden">
                <slot />
            </main>
        </div>
    </div>
</template>
