import { randomUUID } from "node:crypto";
import { ChatCompletionMessageToolCall } from "openai/resources/index";
import { ChatMessage } from "../type";
import type { ToolContext } from "../context";
import type { Tool, ToolResult } from "./index";
import {
    evaluatePermission,
    PERMISSION_TIMEOUT_MS,
    type PermissionVerdict,
} from "../permissions";
import {
    registerInteraction,
    unregisterInteraction,
} from "../pendingInteractions";
import { validateToolArgs } from "./validateArgs";

/** 截断 args 里的长字符串值（>maxLen → 前 maxLen + "[truncated, N total]"）。
 * 防 TOOL 事件 data.args.content（大文件 write）致 SSE 大 payload + 前端 parse 卡。SPEC-022 B-004 / DEC-077。 */
const ARG_TRUNCATE_LEN = 500;

/** 权限 ask 结果（裁决/超时）。 */
type PermissionDecision = "allow_once" | "allow_always" | "deny" | "timeout";

/**
 * 单个 tool call 的执行计划：解析 + schema 校验 + 权限预判（纯同步）的产物。
 * 预判 allow（含会话缓存命中）→ 可直接执行；ask/deny → 串行 gate 路径阻塞裁决。
 */
interface ToolPlan {
    call: ChatCompletionMessageToolCall;
    tool: Tool;
    args: Record<string, unknown>;
    funcName: string;
    /** true = 权限已放行（未启用权限系统 / verdict allow / ask 且缓存命中） */
    preAllowed: boolean;
    verdict: PermissionVerdict | null;
    cacheKey?: string;
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

function toolRow(call: ChatCompletionMessageToolCall, content: string): ChatMessage {
    return { role: "tool", tool_call_id: call.id, content };
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

/**
 * 工具调用分发（唯一分发点，SPEC-032 I-001）。在传入的 tools 列表里按名查 handler；
 * tools 列表本身就是该 agent 的可用工具集——不在列表里 = 不可用。
 *
 * 流程：解析 → 查工具 → schema 校验（FR-10）→ 权限预判（纯同步）→
 * 并行判定（FR-8：批内全部 concurrencySafe 且预判全放行 → Promise.all，结果按调用序落盘）
 * → 否则串行逐个 gate + 执行。
 */
export async function toolCall(
    toolCalls: ChatCompletionMessageToolCall[],
    ctx: ToolContext,
    tools: Tool[],
    turnId?: string
): Promise<ChatMessage[]> {
    const result: ChatMessage[] = [];
    const plans: ToolPlan[] = [];

    // ── 解析与静态判定阶段（同步）：任何失败立即产出错误结果行，不进入执行 ──
    for (const toolCall of toolCalls) {
        // 防御：部分 provider（dashscope/GLM 兼容层）偶发 tool_calls 空条目，跳过不崩
        if (!toolCall) continue;
        if (toolCall.type !== "function") {
            // 用 continue 而非 return：一个异常 tool call 不应丢弃批次内其它结果
            result.push(
                toolRow(toolCall, `[Error] Unsupported tool call type: ${toolCall.type}`)
            );
            continue;
        }
        const funcName: string = toolCall.function.name;

        const tool = tools.find(
            (t) =>
                (t.schema as { function?: { name: string } }).function?.name ===
                funcName
        );
        if (!tool) {
            result.push(toolRow(toolCall, `[Error] Function not found: ${funcName}`));
            continue;
        }

        // LLM 可能返回非法 JSON 参数，parse 失败时回传错误让模型自纠
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
            result.push(
                toolRow(
                    toolCall,
                    `[Error] Invalid JSON arguments for tool ${funcName}: ${toolCall.function.arguments}`
                )
            );
            continue;
        }

        // FR-10：按工具 JSON Schema 校验参数，非法拒绝执行、错误回传模型自纠
        const invalid = validateToolArgs(args, tool.schema);
        if (invalid) {
            result.push(
                toolRow(toolCall, `[Error] Invalid arguments for tool ${funcName}: ${invalid}`)
            );
            continue;
        }

        // 权限预判（纯同步，SPEC-032）：决定并行可行性与串行 gate 行为
        const perm = ctx.permissions;
        let preAllowed = true;
        let verdict: PermissionVerdict | null = null;
        let cacheKey: string | undefined;
        if (perm) {
            verdict = evaluatePermission({
                mode: perm.mode,
                rules: perm.rules,
                dangerPatterns: perm.dangerPatterns,
                readOnlyTools: perm.readOnlyTools,
                tool: funcName,
                args,
            });
            cacheKey = `${funcName}|${verdict.ruleKey ?? funcName}`;
            preAllowed =
                verdict.action === "allow" ||
                (verdict.action === "ask" && perm.allowOnce.has(cacheKey));
        }
        plans.push({ call: toolCall, tool, args, funcName, preAllowed, verdict, cacheKey });
    }

    // ── FR-8 并行路径：批内全部并发安全且预判全放行 → Promise.all，结果按调用序落盘 ──
    const parallelizable =
        plans.length > 1 &&
        plans.every((p) => p.tool.meta?.concurrencySafe === true && p.preAllowed);

    if (parallelizable) {
        // ToolStart 按调用序先发（前端"执行中"卡片顺序稳定）
        for (const p of plans) emitToolStart(p, ctx, turnId);
        // 并发安全工具约定不使用 emitProgress（共享字段，并行期不注入）
        const outputs = await Promise.all(plans.map((p) => runHandler(p, ctx, turnId, false)));
        outputs.forEach((out, i) => {
            emitTool(plans[i], out, ctx, turnId);
            result.push(toolRow(plans[i].call, out.content));
        });
        return result;
    }

    // ── 串行路径：逐个 gate（ask 阻塞裁决一次只弹一个）+ 执行 ──
    for (const p of plans) {
        const denied = await permissionGate(p, ctx);
        if (denied !== null) {
            result.push(toolRow(p.call, denied));
            continue;
        }
        // AR-4：写类工具执行前自动快照（best-effort，失败不阻断）
        if (ctx.snapshot && p.tool.meta?.readOnly !== true) {
            ctx.snapshot.snapshot(`${p.funcName} ${truncateArgs(p.args).command ?? ""}`.trim());
        }
        emitToolStart(p, ctx, turnId);
        const out = await runHandler(p, ctx, turnId, true);
        emitTool(p, out, ctx, turnId);
        result.push(toolRow(p.call, out.content));
    }
    return result;
}

/** 执行 handler 并归一化为结构化结果（FR-10：string 等价 { content }）。 */
async function runHandler(
    plan: ToolPlan,
    ctx: ToolContext,
    turnId: string | undefined,
    injectProgress: boolean
): Promise<ToolResult> {
    if (injectProgress) {
        // emitProgress：注入流式回调，bash 等工具逐 chunk 上抛 TOOL_PROGRESS（turnId 闭包绑定）。
        ctx.emitProgress = (chunk: string) => {
            ctx.eventStream.submit({
                type: "ToolProgress",
                message: chunk,
                turnId,
            });
        };
    }
    let out: string | ToolResult | undefined;
    try {
        out = await plan.tool.handler(plan.args, ctx);
    } finally {
        // 清理注入的回调，避免后续 tool 复用泄漏 / 误发 progress
        if (injectProgress) ctx.emitProgress = undefined;
    }
    // 归一化：string → { content }；ToolResult 原样；undefined/异常形状兜底为空串（不炸事件流）
    if (typeof out === "string") return { content: out };
    if (out && typeof out.content === "string") return out;
    return { content: out == null ? "" : String(out) };
}

function emitToolStart(plan: ToolPlan, ctx: ToolContext, turnId?: string): void {
    // TOOL_START：handler 执行前立即发（前端显"执行中"卡片，消除假死）
    ctx.eventStream.submit({
        type: "ToolStart",
        message: plan.funcName,
        data: { name: plan.funcName, args: truncateArgs(plan.args) },
        turnId,
    });
}

function emitTool(
    plan: ToolPlan,
    out: ToolResult,
    ctx: ToolContext,
    turnId?: string
): void {
    // 一次工具调用的完整画像：name + args + result（+ 结构化 meta，FR-10）都进事件流。
    ctx.eventStream.submit({
        type: "Tool",
        message: plan.funcName,
        data: {
            name: plan.funcName,
            args: truncateArgs(plan.args),
            result: out.content,
            meta: out.data,
        },
        turnId,
    });
}

/**
 * 串行路径的权限 gate（SPEC-032）：返回 null = 放行继续执行；否则返回拒绝文案。
 * 预判已放行（allow / 缓存命中）直接通过；ask/deny 在此阻塞裁决。
 */
async function permissionGate(plan: ToolPlan, ctx: ToolContext): Promise<string | null> {
    const perm = ctx.permissions;
    if (!perm || !plan.verdict || !plan.cacheKey) return null; // 未启用（测试/兼容路径）

    const { verdict, cacheKey, funcName, args } = plan;
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
