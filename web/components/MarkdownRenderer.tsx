"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";

/**
 * MarkdownRenderer。
 * react-markdown 默认不渲染裸 HTML（AST→React 组件），满足 XSS 防护。不用 dangerouslySetInnerHTML。
 * breaks 语感用 remark-breaks（单换行成 <br>）。prose 样式容器（含暗色 prose-invert）。
 */
export function MarkdownRenderer({ content }: { content: string }) {
    return (
        <div className="prose prose-sm max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-pre:my-3 prose-pre:rounded-md prose-pre:bg-muted prose-pre:text-muted-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                {content ?? ""}
            </ReactMarkdown>
        </div>
    );
}

// 防止 lint 报未使用（cn 备用）
void cn;
