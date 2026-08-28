import { ChatCompletionCreateParamsNonStreaming } from "openai/resources/index";
import { randomUUID } from "node:crypto";
import { callLLM } from "./llm";
import { toolCall } from "./tools/toolCall";
import { AgentLoopResult, ChatMessage } from "./type";
import { EventType, serializeError } from "./type";
import type { ToolContext } from "./context";
import type { Tool } from "./tools";
import { compactMessages, AUTO_COMPACT_THRESHOLD } from "./compact";

/**
 * 核心代码，实现AgentLoop，通过循环让大模型持续使用工具。
 * ctx 贯穿（eventStream + workspace）；tools 是该 agent 的工具集（schema + handler）。
 * onCompact：自动压缩替换 messages 后回调持久化（主 agent 落盘；sub-agent 传 undefined）。
 */
export async function agentLoop(
    task: string,
    messages: ChatMessage[],
    maxIterations: number | undefined,
    params: Partial<ChatCompletionCreateParamsNonStreaming> | undefined,
    onMessage: ((msg: ChatMessage) => void | Promise<void>) | undefined,
    ctx: ToolContext,
    tools: Tool[],
    onCompact?: (messages: ChatMessage[]) => void | Promise<void>
): Promise<AgentLoopResult> {
    const maxIter = maxIterations ?? 30;
    const userMsg: ChatMessage = {
        role: "user",
        content: task,
    };
    messages.push(userMsg);
    await onMessage?.(userMsg);
    let lastUsage: { prompt_tokens: number } | undefined;
    for (let i = 0; i < maxIter; i++) {
        // 迭代边界先查中断：stop() 已 abort 的话直接返回，不发起 LLM 调用
        if (ctx.signal.aborted) {
            return { result: "[stopped]", messages };
        }
        // 自动压缩：上一轮真实 usage.prompt_tokens >= 75% * contextWindow → 压缩后继续。
        // 真实 usage 最准（无需 tokenizer）；首迭代无 usage 不会触 75%。
        if (
            lastUsage &&
            ctx.llm?.contextWindow &&
            lastUsage.prompt_tokens >=
                AUTO_COMPACT_THRESHOLD * ctx.llm.contextWindow
        ) {
            try {
                const res = await compactMessages(messages, ctx.llm, undefined, ctx.signal);
                if (res.compacted) {
                    messages.length = 0;
                    messages.push(...res.messages);
                    lastUsage = undefined;
                    await onCompact?.(res.messages);
                    ctx.eventStream.submit({
                        type: "Compact",
                        message: `已压缩上下文 ${res.beforeTokens}→${res.afterTokens} tokens`,
                        data: {
                            beforeTokens: res.beforeTokens,
                            afterTokens: res.afterTokens,
                            auto: true,
                        },
                    });
                }
            } catch (err) {
                if (ctx.signal.aborted) {
                    return { result: "[stopped]", messages };
                }
                // 压缩失败不阻断主循环：发 Warning（非终态），循环继续原 messages（下轮可能再试）。
                // web TERMINAL 不含 Warning → 不会误终止 run（SPEC-030 B-003/I-003，修 latent bug）。
                ctx.eventStream.submit({
                    type: "Warning",
                    message: `自动压缩失败：${
                        err instanceof Error ? err.message : String(err)
                    }`,
                    error: serializeError(err),
                });
            }
        }
        // 同一回合的 ITERATION/ASSISTANT/TOOL 事件共用 turnId,
        // 前端据此把 "assistant 文本 + 紧随的工具调用" 组成块状展示。
        const turnId = randomUUID();
        ctx.eventStream.submit({
            type: "Iteration",
            message: `Iteration ${i + 1}/${maxIter}`,
            turnId,
        });
        let msg;
        try {
            msg = await callLLM(
                messages,
                { ...params, tools: tools.map((t) => t.schema) },
                ctx.signal,
                // 流式 delta：每段 text 到达即发 ASSISTANT_DELTA（实时态，不入盘）。
                // 非流式 provider 不调 onDelta，无 delta 事件。
                (delta) =>
                    ctx.eventStream.submit({
                        type: "AssistantDelta",
                        message: delta,
                        turnId,
                    }),
                ctx.llm,
                // 思考内容（reasoning_content）：部分模型支持，发 THINKING 事件
                (delta) =>
                    ctx.eventStream.submit({
                        type: "Thinking",
                        message: delta,
                        turnId,
                    }),
                // tool_call arguments 流式心跳：每 4KB 发 TOOL_ARG_PROGRESS（只 bytes+name），
                // 避免 LLM 流式输出大 write content 时事件流静默冻屏。SPEC-022 B-003 / DEC-076
                (info) =>
                    ctx.eventStream.submit({
                        type: "ToolArgProgress",
                        message: info.name ?? "tool",
                        data: { bytes: info.bytes, name: info.name },
                        turnId,
                    })
            );
        } catch (err) {
            // callLLM 流式 abort 时返回截断（不抛），此处只兜底其他异常
            if (ctx.signal.aborted) {
                return { result: "[stopped]", messages };
            }
            throw err;
        }
        // abort 截断：callLLM 返回已累积的截断 message（仅 content），定稿落盘后返回 stopped
        if (ctx.signal.aborted) {
            if (msg?.content) {
                messages.push(msg);
                await onMessage?.(msg);
                ctx.eventStream.submit({
                    type: "Assistant",
                    message: msg.content,
                    turnId,
                });
            }
            return { result: "[stopped]", messages };
        }
        messages.push(msg);
        await onMessage?.(msg);
        if (msg.content) {
            ctx.eventStream.submit({
                type: "Assistant",
                message: msg.content,
                turnId,
            });
        }
        if (msg.usage) {
            lastUsage = msg.usage;
            ctx.eventStream.submit({
                type: "Usage",
                message: `${msg.usage.prompt_tokens}/${
                    ctx.llm?.contextWindow ?? 128000
                }`,
                data: {
                    prompt_tokens: msg.usage.prompt_tokens,
                    completion_tokens: msg.usage.completion_tokens,
                    contextWindow: ctx.llm?.contextWindow ?? 128000,
                },
                turnId,
            });
        }
        if (!msg?.tool_calls) {
            return {
                result: msg.content || "",
                messages,
            };
        } else {
            const toolResults = await toolCall(msg.tool_calls, ctx, tools, turnId);
            messages.push(...toolResults);
            for (const tr of toolResults) {
                await onMessage?.(tr);
            }
        }
    }
    return {
        result: "Max iterations reached",
        messages,
    };
}
