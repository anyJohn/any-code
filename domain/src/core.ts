import { ChatCompletionCreateParamsNonStreaming } from "openai/resources/index";
import { randomUUID } from "node:crypto";
import { callLLM } from "./llm";
import { toolCall } from "./tools/toolCall";
import { AgentLoopResult, ChatMessage } from "./type";
import { serializeError } from "./type";
import type { ToolContext } from "./context";
import type { Tool } from "./tools";
import {
    compactMessages,
    microcompactMessages,
    estimateTokens,
    AUTOCOMPACT_BUFFER,
    MICROCOMPACT_RATIO,
} from "./compact";
import { isContextOverflowError } from "./llm";

/**
 * AR-23 日志不变式：统计"未确认落盘却进入了模型请求"的非 system 消息数。
 * seen 由 driving adapter（main.ts）经 onMessage / 压缩回调标记；>0 = 不变式破坏。
 * system head（messages[0]）动态装配不入盘，不在检查范围。
 */
export function countUnloggedMessages(
    messages: ChatMessage[],
    seen: WeakSet<object>
): number {
    let n = 0;
    for (let k = 1; k < messages.length; k++) {
        const m = messages[k] as unknown as { role?: string };
        if (m?.role === "system") continue;
        if (!seen.has(messages[k] as unknown as object)) n++;
    }
    return n;
}

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
    // 迭代上限缺省 150（用户决策 2026-09-03：30 对长任务太小；AgentDefinition.maxIterations 可覆盖）
    const maxIter = maxIterations ?? 150;
    const userMsg: ChatMessage = {
        role: "user",
        content: task,
    };
    messages.push(userMsg);
    await onMessage?.(userMsg);
    // User 事件入流（durable，作 reload 真值）。web live 端已乐观插入 user 气泡，
    // 此 server 事件会被 web 去重（同 message），不重复显示。
    ctx.eventStream.submit({ type: "User", message: task });
    let lastUsage: { prompt_tokens: number } | undefined;
    // AR-9：被动压缩只试一次（压缩后仍超限则原错误上抛，避免循环）
    let reactiveCompacted = false;
    for (let i = 0; i < maxIter; i++) {
        // 迭代边界先查中断：stop() 已 abort 的话直接返回，不发起 LLM 调用
        if (ctx.signal.aborted) {
            return { result: "[stopped]", messages, stopReason: "stopped" };
        }
        // 分级压缩（FR-6）：micro（清陈旧 tool result）先于全量摘要；
        // 全量阈值 = 窗口 - 固定 buffer（不再用比例）；真实 usage 最准。
        if (
            lastUsage &&
            ctx.llm?.contextWindow &&
            lastUsage.prompt_tokens >= MICROCOMPACT_RATIO * ctx.llm.contextWindow
        ) {
            const window = ctx.llm.contextWindow;
            const overFull =
                lastUsage.prompt_tokens >= window - AUTOCOMPACT_BUFFER;
            // 第一级：microcompact——只清陈旧 tool result，够则免摘要
            const cleaned = microcompactMessages(messages);
            if (cleaned) {
                const before = estimateTokens(messages);
                lastUsage = undefined; // 下轮真实 usage 重新判定
                // AR-23：micro 原地清了 tool result 内容——必须同步落盘，
                // 否则内存与日志漂移，"喂给模型的必能从日志重建"被破坏。
                await onCompact?.(messages);
                ctx.eventStream.submit({
                    type: "Compact",
                    message: `已清理陈旧工具结果，释放上下文`,
                    data: {
                        beforeTokens: before,
                        afterTokens: estimateTokens(messages),
                        auto: true,
                        micro: true,
                    },
                });
                // micro 后仍超全量线 → 继续走全量摘要
            }
            if (overFull && (!cleaned || estimateTokens(messages) >= window - AUTOCOMPACT_BUFFER)) {
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
                    return { result: "[stopped]", messages, stopReason: "stopped" };
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
        }
        // 同一回合的 ITERATION/ASSISTANT/TOOL 事件共用 turnId,
        // 前端据此把 "assistant 文本 + 紧随的工具调用" 组成块状展示。
        const turnId = randomUUID();
        ctx.eventStream.submit({
            type: "Iteration",
            message: `Iteration ${i + 1}/${maxIter}`,
            turnId,
        });
        // AR-23：运行时断言——进入请求的非 system 消息必须已确认落盘。
        // 破坏只告警不阻断（审计信号，非安全闸）；每 run 至多一次防刷屏。
        if (ctx.logInvariant && !ctx.logInvariant.warned) {
            const unlogged = countUnloggedMessages(messages, ctx.logInvariant.seen);
            if (unlogged > 0) {
                ctx.logInvariant.warned = true;
                ctx.eventStream.submit({
                    type: "Warning",
                    message: `日志不变式告警：${unlogged} 条消息未落盘即进入模型请求（AR-23）`,
                });
            }
        }
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
                // tool_call arguments 流式心跳：每 2KB 发 TOOL_ARG_PROGRESS（只 bytes+name），
                // 避免 LLM 流式输出大 write content 时事件流静默冻屏。SPEC-022 B-002 / DEC-076
                (info) =>
                    ctx.eventStream.submit({
                        type: "ToolArgProgress",
                        message: info.name ?? "tool",
                        data: { bytes: info.bytes, name: info.name },
                        turnId,
                    }),
                // 重试可见性（AR-1）：Warning durable 事件，前端 amber 行展示
                (info) =>
                    ctx.eventStream.submit({
                        type: "Warning",
                        message: `LLM 调用失败，第 ${info.attempt}/${info.maxRetries} 次重试（${info.delayMs}ms 后）：${info.error}`,
                    })
            );
        } catch (err) {
            // callLLM 流式 abort 时返回截断（不抛），此处只兜底其他异常
            if (ctx.signal.aborted) {
                return { result: "[stopped]", messages, stopReason: "stopped" };
            }
            // AR-9 错误恢复梯度：上下文超限被 provider 拒绝 → 被动压缩后重试同一轮
            if (ctx.llm && !reactiveCompacted && isContextOverflowError(err)) {
                reactiveCompacted = true;
                try {
                    const res = await compactMessages(messages, ctx.llm, undefined, ctx.signal);
                    if (res.compacted) {
                        messages.length = 0;
                        messages.push(...res.messages);
                        await onCompact?.(res.messages);
                        ctx.eventStream.submit({
                            type: "Compact",
                            message: `请求超限（${(err as Error).message.slice(0, 80)}），已被动压缩 ${res.beforeTokens}→${res.afterTokens} tokens 后重试`,
                            data: {
                                beforeTokens: res.beforeTokens,
                                afterTokens: res.afterTokens,
                                auto: true,
                            },
                        });
                        i -= 1; // 重试本轮（continue 会 i++，此处抵消）
                        continue;
                    }
                } catch {
                    // 压缩失败 → 原错误上抛
                }
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
            return { result: "[stopped]", messages, stopReason: "stopped" };
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
                    model: ctx.llm?.defaultModel, // FR-22：模型戳，费用按模型单价换算
                },
                turnId,
            });
        }
        if (!msg?.tool_calls) {
            return {
                result: msg.content || "",
                messages,
                stopReason: "completed",
            };
        } else {
            const toolResults = await toolCall(msg.tool_calls, ctx, tools, turnId);
            messages.push(...toolResults);
            for (const tr of toolResults) {
                await onMessage?.(tr);
            }
        }
    }
    // 迭代上限耗尽：明确终态语义 + 用户可见建议动作（FR-14，不再静默返回字符串）
    ctx.eventStream.submit({
        type: "Warning",
        message: `任务在 ${maxIter} 轮迭代后达到上限，可能尚未完成。可继续对话让 agent 接着做，或 /compact 释放上下文后重试。`,
    });
    return {
        result: "Max iterations reached",
        messages,
        stopReason: "max_iterations",
    };
}
