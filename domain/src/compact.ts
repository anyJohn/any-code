import type { ChatMessage } from "./type";
import type { LlmProvider } from "./config";
import OpenAI from "openai";
import {
    COMPACT_HANDOFF_PREFIX,
    COMPACT_SUMMARIZER_SYSTEM,
    buildCompactionPrompt,
} from "./prompt";

/**
 * 上下文压缩：把旧消息总结成一条摘要 + 保留近期尾部原文 + 保护 system prompt，
 * 切割边界保留 tool_call/tool_result 配对。调研业界主流 harness 后的同构实现：
 * 都用 chars/4 启发式（非真 tokenizer）、都优先用 provider 真实 usage、都保护 system、
 * 都保留尾部原文 + 摘要中段。所有 prompt 文本见 ./prompt.ts。
 */

const CHARS_PER_TOKEN = 4;
const TOOL_OUTPUT_MAX_CHARS = 2000;
const SUMMARY_MAX_TOKENS = 4096;

/** 尾部保留的最近消息条数（配对感知：tool 起始会回拉父 assistant）。 */
export const KEEP_RECENT_MESSAGES = 6;

/** 自动压缩阈值：真实 usage.prompt_tokens >= 该比例 * contextWindow 时触发。 */
export const AUTO_COMPACT_THRESHOLD = 0.75;

// HANDOFF_PREFIX / SUMMARIZER_SYSTEM / 模板 / 拼装函数均在 ./prompt.ts，此处仅 re-export 供测试引用。
export { COMPACT_HANDOFF_PREFIX };

export interface CompactOptions {
    focus?: string;
    /** 尾部保留消息条数（默认 KEEP_RECENT_MESSAGES）。可调，便于测试与未来调参。 */
    keepN?: number;
}

export interface CompactResult {
    messages: ChatMessage[];
    summary: string;
    beforeTokens: number;
    afterTokens: number;
    compacted: boolean;
}

/** token 估算：有真实 usage 用 prompt_tokens（最准），否则 chars/4 over JSON 兜底。 */
export function estimateTokens(
    messages: ChatMessage[],
    lastUsage?: { prompt_tokens?: number }
): number {
    if (lastUsage?.prompt_tokens != null) return lastUsage.prompt_tokens;
    try {
        return Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);
    } catch {
        return 0;
    }
}

function contentToText(content: unknown): string {
    if (typeof content === "string") return content;
    if (content == null) return "";
    if (Array.isArray(content)) {
        return content
            .map((p) =>
                typeof p === "string" ? p : (p as { text?: string } | null)?.text ?? ""
            )
            .join("");
    }
    return String(content);
}

function truncate(s: string): string {
    if (s.length <= TOOL_OUTPUT_MAX_CHARS) return s;
    return s.slice(0, TOOL_OUTPUT_MAX_CHARS) + "\n…[truncated]";
}

/** 把一条消息序列化成摘要器可读的文本行。tool 输出截断。 */
function serializeMessage(msg: ChatMessage): string {
    const m = msg as unknown as Record<string, unknown>;
    const role = m.role as string;
    const text = () => contentToText(m.content);
    if (role === "user") return `[User]: ${text()}`;
    if (role === "assistant") {
        const parts: string[] = [`[Assistant]: ${text()}`];
        const tcs = m.tool_calls as
            | Array<{ function?: { name?: string; arguments?: string } }>
            | undefined;
        if (Array.isArray(tcs)) {
            for (const tc of tcs) {
                parts.push(
                    `[Assistant tool call]: ${tc?.function?.name ?? "?"}(${
                        tc?.function?.arguments ?? ""
                    })`
                );
            }
        }
        return parts.join("\n");
    }
    if (role === "tool") return `[Tool result]: ${truncate(text())}`;
    if (role === "system") return `[System]: ${text()}`;
    return `[${role}]: ${truncate(text())}`;
}

/**
 * rest 切 head(摘要)/tail(保留原文)。tail = 最后 keepN 条；配对感知：
 * tail 起始若为 tool 消息，回拉切割点把其父 assistant(tool_calls) 一并纳入 tail，
 * 保证 tail 内 tool 消息都有配对的 tool_call。
 */
export function splitForCompact(
    rest: ChatMessage[],
    keepN: number
): { head: ChatMessage[]; tail: ChatMessage[] } {
    const n = Math.min(keepN, rest.length);
    let cut = rest.length - n;
    // tail[0] 为 tool 时持续回拉，直到落到其父 assistant(tool_calls)
    while (cut > 0 && (rest[cut] as unknown as Record<string, unknown>).role === "tool") {
        cut -= 1;
    }
    return { head: rest.slice(0, cut), tail: rest.slice(cut) };
}

/** 调 LLM 产出结构化摘要（同 provider、禁用工具、非流式、max_tokens 4096）。 */
async function summarize(
    llm: LlmProvider,
    conversation: string,
    opts: { focus?: string; previousSummary?: string },
    signal?: AbortSignal
): Promise<string> {
    const client = new OpenAI({ apiKey: llm.apiKey, baseURL: llm.baseURL });
    const userPrompt = buildCompactionPrompt(
        conversation,
        opts.previousSummary,
        opts.focus
    );
    const resp = await client.chat.completions.create(
        {
            model: llm.defaultModel,
            messages: [
                { role: "system", content: COMPACT_SUMMARIZER_SYSTEM },
                { role: "user", content: userPrompt },
            ],
            max_tokens: SUMMARY_MAX_TOKENS,
        },
        { signal }
    );
    const text = resp.choices[0]?.message?.content;
    if (!text) throw new Error("compaction summarizer returned no content");
    return text;
}

/**
 * 压缩 messages：[system, ...rest] → [system, summaryMsg?, ...tail]。
 * system[0] 保护不摘要；head 序列化→LLM 摘要；tail 保留原文。
 * 摘要存为 role=user + handoff 前缀；tail[0] 为 user 时合并进 tail[0] 避免 user→user 邻接。
 * head 为空（对话太短）→ compacted=false，原样返回。
 */
export async function compactMessages(
    messages: ChatMessage[],
    llm: LlmProvider,
    opts?: CompactOptions,
    signal?: AbortSignal
): Promise<CompactResult> {
    const beforeTokens = estimateTokens(messages, undefined);
    let systemMsg: ChatMessage | undefined;
    let rest: ChatMessage[];
    if (
        messages.length > 0 &&
        (messages[0] as unknown as Record<string, unknown>).role === "system"
    ) {
        systemMsg = messages[0];
        rest = messages.slice(1);
    } else {
        rest = messages.slice();
    }

    const { head, tail } = splitForCompact(rest, opts?.keepN ?? KEEP_RECENT_MESSAGES);
    if (head.length === 0) {
        return {
            messages,
            summary: "",
            beforeTokens,
            afterTokens: beforeTokens,
            compacted: false,
        };
    }

    // 旧摘要检测：head[0] 若是上一轮压缩留下的 user 摘要（含 handoff 前缀），取出走 update 模式。
    let previousSummary = "";
    let headForSerialize = head;
    if (
        head.length > 0 &&
        (head[0] as unknown as Record<string, unknown>).role === "user"
    ) {
        const c = contentToText((head[0] as unknown as Record<string, unknown>).content);
        if (typeof c === "string" && c.startsWith(COMPACT_HANDOFF_PREFIX)) {
            previousSummary = c.slice(COMPACT_HANDOFF_PREFIX.length);
            headForSerialize = head.slice(1);
        }
    }

    const serialized = headForSerialize.map(serializeMessage).join("\n\n");
    const summary = await summarize(
        llm,
        serialized,
        { focus: opts?.focus, previousSummary },
        signal
    );

    const summaryContent = COMPACT_HANDOFF_PREFIX + summary;
    let newRest: ChatMessage[];
    if (
        tail.length > 0 &&
        (tail[0] as unknown as Record<string, unknown>).role === "user"
    ) {
        // tail[0] 为 user：摘要合并进 tail[0]，避免 user→user 邻接。
        const merged: ChatMessage = {
            role: "user",
            content:
                summaryContent +
                "\n\n--- Latest message ---\n" +
                contentToText((tail[0] as unknown as Record<string, unknown>).content),
        } as ChatMessage;
        newRest = [merged, ...tail.slice(1)];
    } else {
        newRest = [
            { role: "user", content: summaryContent } as ChatMessage,
            ...tail,
        ];
    }

    const newMessages = systemMsg ? [systemMsg, ...newRest] : newRest;
    const afterTokens = estimateTokens(newMessages, undefined);
    return {
        messages: newMessages,
        summary,
        beforeTokens,
        afterTokens,
        compacted: true,
    };
}
