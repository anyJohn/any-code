"use client";

import { memo, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { useT } from "@/i18n";

/**
 * 复制按钮（SPEC-036 B-001/B-002）：点击复制文本，成功后短暂打勾反馈。
 * 代码块头部与整条消息 hover 复用。
 */
export function CopyButton({ text, className }: { text: string; className?: string }) {
    const { t } = useT();
    const [copied, setCopied] = useState(false);
    const onCopy = useCallback(() => {
        void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, [text]);
    return (
        <button
            onClick={onCopy}
            title={t("common.copy")}
            className={className}
        >
            {copied ? (
                <Check className="size-3.5 text-emerald-500" />
            ) : (
                <Copy className="size-3.5" />
            )}
        </button>
    );
}

/** 代码块：语言标签 + 复制按钮 + 横向滚动（SPEC-036 B-001/B-004）。 */
const CodeBlock = memo(function CodeBlock({
    className,
    children,
}: {
    className?: string;
    children?: React.ReactNode;
}) {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    const raw = extractText(children);
    return (
        <div className="group/code relative my-3">
            <div className="flex items-center justify-between rounded-t-md border border-zinc-800 bg-zinc-900 px-3 py-1">
                <span className="text-xs text-zinc-400">{lang ?? "text"}</span>
                <CopyButton
                    text={raw}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-400"
                />
            </div>
            <pre className="rounded-t-none border border-t-0 border-zinc-800 bg-zinc-950 overflow-x-auto p-3 text-xs leading-relaxed text-zinc-100 [&>code]:bg-transparent [&>code]:!px-0 [&>code]:!py-0">
                <code className={className}>{children}</code>
            </pre>
        </div>
    );
});

/** 递归取 React 子树的文本内容（复制按钮用——拿代码原文而非 JSX）。 */
function extractText(node: React.ReactNode): string {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(extractText).join("");
    if (typeof node === "object" && "props" in node) {
        return extractText((node as { props: { children?: React.ReactNode } }).props.children);
    }
    return "";
}

/**
 * MarkdownRenderer。
 * react-markdown 默认不渲染裸 HTML（AST→React 组件），满足 XSS 防护。不用 dangerouslySetInnerHTML。
 * breaks 语感用 remark-breaks（单换行成 <br>）。prose 样式容器（含暗色 prose-invert）。
 * rehype-highlight（SPEC-036 B-001）：highlight.js 全语言（按扩展名/语言标记自动识别），
 * 主题 CSS 在全局引入（github + github-dark，随明暗类切换）。
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
    content,
}: {
    content: string;
}) {
    return (
        <div className="prose prose-sm max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none dark:prose-invert">
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeHighlight]}
                components={{ pre: CodeBlock }}
            >
                {content ?? ""}
            </ReactMarkdown>
        </div>
    );
});
