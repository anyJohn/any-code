<script setup lang="ts">
// Markdown 渲染：把 LLM 回复的 markdown 渲染成 HTML，用 Tailwind typography 的 prose 美化。
// html:false —— 原样转义 LLM 输出里的裸 HTML，避免 XSS（LLM 内容半可信，仍不放心）。
// breaks:true —— 单换行也成 <br>，贴合聊天里"一段一行"的语感。
// linkify:true —— 裸 URL 自动成链接。
import MarkdownIt from "markdown-it";

const props = defineProps<{ content: string }>();

const md = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
});

const html = computed(() => md.render(props.content ?? ""));
</script>

<template>
    <!-- prose prose-sm：typography 默认排版；max-w-none 关掉 prose 自己的宽度限制
         （父容器已控宽）；prose-p:my-2 等收紧聊天里过大的段落间距；
         prose-pre:rounded 让代码块圆角；dark:prose-invert 暗色自适应。 -->
    <div
        class="prose prose-sm max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-pre:my-3 prose-pre:rounded-md prose-pre:bg-muted prose-pre:text-muted-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none dark:prose-invert"
        v-html="html"
    />
</template>
