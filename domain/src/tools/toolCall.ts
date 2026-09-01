import { randomUUID } from "node:crypto";
import { ChatCompletionMessageToolCall } from "openai/resources/index";
import { ChatMessage } from "../type";
import type { ToolContext } from "../context";
import type { Tool } from "./index";
import {
    evaluatePermission,
    PERMISSION_TIMEOUT_MS,
    type PermissionVerdict,
} from "../permissions";
import {
    registerInteraction,
    unregisterInteraction,
} from "../pendingInteractions";

/** 截断 args 里的长字符串值（>maxLen → 前 maxLen + "[truncated, N total]"）。
 * 防 TOOL 事件 data.args.content（大文件 write）致 SSE 大 payload + 前端 parse 卡。SPEC-022 B-004 / DEC-077。 */
const ARG_TRUNCATE_LEN = 500;

/** 权限 ask 结果（裁决/超时）。 */
type PermissionDecision = "allow_once" | "allow_always" | "deny" | "timeout";

/** 权限判定与裁决（SPEC-032）：返回 null = 放行继续执行；否则返回拒绝文案（role:tool 结果）。 */
async function permissionGate(
    funcName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
    turnId?: string
): Promise<string | null> {
    const perm = ctx.permissions;
    if (!perm) return null; // 未启用（测试/兼容路径）——I-001 的直通豁免仅此一处

    const verdict = evaluatePermission({
        mode: perm.mode,
        rules: perm.rules,
        dangerPatterns: perm.dangerPatterns,
        tool: funcName,
        args,
    });
    const summary = JSON.stringify(truncateArgs(args));

    // allow：仅用户规则放行需审计（mode 默认放行不打扰事件流，AC-007）
    if (verdict.action === "allow") {
        if (verdict.source === "rule") audit(ctx, funcName, args, verdict, "decided");
        return null;
    }

    // deny：永不执行 handler（I-002），结果回传模型自纠（C-002）
    if (verdict.action === "deny") {
        audit(ctx, funcName, args, verdict, "decided", "deny");
        return `[Permission denied] 工具 ${funcName} 被用户的权限规则拒绝（匹配：${verdict.ruleKey ?? funcName}）。请改用已获允许的方式，或先向用户说明并获得授权。`;
    }

    // ask：会话缓存命中（D-007）→ 直通
    const cacheKey = `${funcName}|${verdict.ruleKey ?? funcName}`;
    if (perm.allowOnce.has(cacheKey)) return null;

    // ask：阻塞等裁决（B-005），120s 超时按拒绝（D-006），abort 干净退出
    audit(ctx, funcName, args, verdict, "asked");
    const decision = await askUser(verdict, funcName, summary, ctx);
    audit(ctx, funcName, args, verdict, "decided", decision);

    if (decision === "allow_once") {
        perm.allowOnce.add(cacheKey);
        return null;
    }
    if (decision === "allow_always") {
        // 内存态立即生效（同 run 内后续同类直通）；落盘由 web 端经 PUT permissions 完成
        perm.rules.push({
            tool: funcName,
            pattern: verdict.ruleKey,
            action: "allow",
        });
        return null;
    }
    const reason =
        decision === "timeout"
            ? `等待用户授权超时（${PERMISSION_TIMEOUT_MS / 1000}s）`
            : "用户拒绝了本次执行";
    return `[Permission denied] ${reason}：${funcName}。请改用其他方式完成目标，或先向用户说明操作意图与原因后再请求授权。`;
}

/** 发权限裁决请求并阻塞等答案（复用 pendingInteractions 通道，与 ask_question 同构）。 */
async function askUser(
    verdict: PermissionVerdict,
    funcName: string,
    summary: string,
    ctx: ToolContext
): Promise<PermissionDecision> {
    const id = randomUUID();
    const answersPromise = new Promise<string[]>((resolve) => {
        registerInteraction(id, { resolve });
    });
    const abortPromise = new Promise<"aborted">((resolve) => {
        if (ctx.signal.aborted) return resolve("aborted");
        ctx.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
    const timeoutPromise = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), PERMISSION_TIMEOUT_MS);
    });

    ctx.eventStream.submit({
        type: "PermissionAsk",
        message: `permission: ${funcName}`,
        data: {
            id,
            tool: funcName,
            pattern: verdict.ruleKey,
            summary,
            danger: verdict.source === "baseline",
        },
    });

    const raced = await Promise.race([
        answersPromise.then((answers) => ({ kind: "answered" as const, answers })),
        abortPromise.then(() => ({ kind: "aborted" as const })),
        timeoutPromise.then(() => ({ kind: "timeout" as const })),
    ]);
    if (raced.kind !== "answered") {
        unregisterInteraction(id);
        return raced.kind === "timeout" ? "timeout" : "deny";
    }
    const first = raced.answers[0];
    if (first === "allow_once" || first === "allow_always" || first === "deny") {
        return first;
    }
    return "deny";
}

/** 权限审计事件（B-008，durable）：asked / decided（含 deny 硬拦与超时）。 */
function audit(
    ctx: ToolContext,
    funcName: string,
    args: Record<string, unknown>,
    verdict: PermissionVerdict,
    phase: "asked" | "decided",
    decision?: PermissionDecision
): void {
    ctx.eventStream.submit({
        type: "Permission",
        message: `permission ${phase}: ${funcName}`,
        data: {
            tool: funcName,
            pattern: verdict.ruleKey,
            source: verdict.source,
            action: verdict.action,
            phase,
            decision,
            summary: JSON.stringify(truncateArgs(args)),
        },
    });
}
function truncateArgs(args: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
        if (typeof v === "string" && v.length > ARG_TRUNCATE_LEN) {
            out[k] = v.slice(0, ARG_TRUNCATE_LEN) + `[truncated, ${v.length} total]`;
        } else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * 工具调用分发。在传入的 tools 列表里按名查 handler。
 * tools 列表本身就是该 agent 的可用工具集——不在列表里 = 不可用。
 */
export async function toolCall(
    tooCalls: ChatCompletionMessageToolCall[],
    ctx: ToolContext,
    tools: Tool[],
    turnId?: string
): Promise<ChatMessage[]> {
    const result: ChatMessage[] = [];
    for (const toolCall of tooCalls) {
        // 防御：部分 provider（dashscope/GLM 兼容层）偶发 tool_calls 空条目，跳过不崩
        // （报错形如 `Cannot read properties of undefined (reading 'type')`）。
        if (!toolCall) continue;
        if (toolCall.type !== "function") {
            // 用 continue 而非 return：一个异常 tool call 不应丢弃批次内其它结果
            result.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `[Error] Unsupported tool call type: ${toolCall.type}`,
            });
            continue;
        }
        const funcName: string = toolCall.function.name;

        const tool = tools.find(
            (t) =>
                (t.schema as { function?: { name: string } }).function?.name ===
                funcName
        );
        if (!tool) {
            result.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `[Error] Function not found: ${funcName}`,
            });
            continue;
        }

        // LLM 可能返回非法 JSON 参数，parse 失败时回传错误让模型自纠
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
            result.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `[Error] Invalid JSON arguments for tool ${funcName}: ${toolCall.function.arguments}`,
            });
            continue;
        }

        // 权限判定（SPEC-032 I-001，唯一分发点）：deny/拒绝/超时 → 拒绝文案作工具结果，不执行 handler
        const denied = await permissionGate(funcName, args, ctx, turnId);
        if (denied !== null) {
            result.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: denied,
            });
            continue;
        }

        // TOOL_START：handler 执行前立即发（前端显"执行中"卡片，消除假死）。
        // emitProgress：注入流式回调，bash 等工具逐 chunk 上抛 TOOL_PROGRESS（turnId 闭包绑定）。
        ctx.emitProgress = (chunk: string) => {
            ctx.eventStream.submit({
                type: "ToolProgress",
                message: chunk,
                turnId,
            });
        };
        ctx.eventStream.submit({
            type: "ToolStart",
            message: funcName,
            data: { name: funcName, args: truncateArgs(args) },
            turnId,
        });

        let toolOutput: string;
        try {
            toolOutput = await tool.handler(args, ctx);
        } finally {
            // 清理注入的回调，避免后续 tool 复用泄漏 / 误发 progress
            ctx.emitProgress = undefined;
        }
        // 一次工具调用的完整画像：name + args + result 都进事件流。
        // 这是未来权限/黑白名单/bypass 的天然拦截点——在此处做策略决策即可。
        ctx.eventStream.submit({
            type: "Tool",
            message: funcName,
            data: { name: funcName, args: truncateArgs(args), result: toolOutput },
            turnId,
        });
        result.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolOutput,
        });
    }
    return result;
}
