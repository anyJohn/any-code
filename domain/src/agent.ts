import { randomUUID } from "node:crypto";
import { agentLoop } from "./core";
import {
    systemPrompt,
    planAgentInstruction,
    planExecutionInstruction,
} from "./prompt";
import { ToolKit } from "./tools";
import type { Tool } from "./tools";
import type { ChatMessage } from "./type";
import type { EventEmitter, ToolContext } from "./context";
import {
    registerInteraction,
    unregisterInteraction,
} from "./pendingInteractions";

/**
 * Agent 定义（声明式）：name + 触发描述 + system prompt + 工具集 + 迭代上限。
 * 纯配置，不含运行时状态。domain 预置 planAgent / mainAgent，用户也可自定义。
 */
export interface AgentDefinition {
    name: string;
    description: string; // 何时委托该 sub-agent（作为 AgentTool schema 的 description）
    instruction: string; // system prompt
    tools: Tool[];
    maxIterations?: number;
    /** 可用模型覆盖（FR-11）：同 provider 下切换模型；缺省用父 provider 的 defaultModel */
    model?: string;
    /** 可用 provider 覆盖（FR-11）：ctx.providers 里的命名 provider；缺省继承父 */
    provider?: string;
    /** 委托深度（FR-11）：该 sub-agent 允许再委托的层数，缺省 0（不可再委托，防递归） */
    maxDepth?: number;
}

/**
 * 把一个 AgentDefinition 包装成 Tool，供别的 agent 当工具调用。
 * sub-agent 运行在独立 context：独立 eventStream（中间过程对父流不可见）、
 * 独立 messages（只含自己的 instruction + task）、共享 workspace。
 * 跑完返回 result 字符串给父 agent。per-invocation 无状态。
 */
export function AgentTool(def: AgentDefinition): Tool {
    return {
        schema: {
            type: "function",
            function: {
                name: def.name,
                description: def.description,
                parameters: {
                    type: "object",
                    properties: {
                        task: {
                            type: "string",
                            description: "The focused task to delegate to this sub-agent",
                        },
                    },
                    required: ["task"],
                },
            },
        },
        handler: async (args, ctx) => {
            const { task } = args as { task: string };
            // FR-11 深度限制：ctx.subagentDepth 为当前已委托层数；超限拒绝（防递归委托）
            const depth = ctx.subagentDepth ?? 0;
            if (depth > (def.maxDepth ?? 0)) {
                return `[Error] 委托深度超限（当前 ${depth} 层，${def.name} 允许至多 ${(def.maxDepth ?? 0)} 层再委托）。请直接完成任务，不要继续委派。`;
            }
            const runId = randomUUID();
            const parentStream = ctx.eventStream;
            // tagged proxy：sub-agent 事件转发到父流,打上 author(def.name)+runId。
            // 前端按 runId 分组折叠展示,主流不被淹没但 sub-agent 过程可见。
            const tagged: EventEmitter = {
                submit: (e) =>
                    parentStream.submit({ ...e, author: def.name, runId }),
            };
            // FR-11：provider/model 覆盖——def.provider 命名 ctx.providers 中的 provider，
            // def.model 覆盖 defaultModel；都缺省继承父。
            let llm = ctx.llm;
            if (ctx.providers && def.provider && ctx.providers[def.provider]) {
                llm = ctx.providers[def.provider];
            }
            if (llm && def.model) {
                llm = { ...llm, defaultModel: def.model };
            }
            const subCtx = {
                workspace: ctx.workspace,
                eventStream: tagged,
                signal: ctx.signal,
                // 子 agent 复用父的 fileState（read→write staleness 共享）。
                llm,
                fileState: ctx.fileState,
                gitBashPath: ctx.gitBashPath,
                // 权限上下文透传（SPEC-032）：子 agent 同受权限门控
                permissions: ctx.permissions,
                // 快照钩子透传（AR-4）：子 agent 写类工具同样先快照
                snapshot: ctx.snapshot,
                // FR-11：技能目录透传（此前子 agent 调 use_skill 拿到空目录）
                skills: ctx.skills,
                // FR-11：子 agent 长任务压缩落盘（内存态 messages 已在 loop 内原地替换；
                // 子 agent 不持久化，无需 onCompact 落盘回调，压缩本身即可防超窗）
                providers: ctx.providers,
                subagentDepth: depth + 1,
            };
            const messages: ChatMessage[] = [
                { role: "system", content: def.instruction },
            ];
            const { result } = await agentLoop(
                task,
                messages,
                def.maxIterations,
                {},
                undefined,
                subCtx,
                def.tools
            );
            return result;
        },
        // sub-agent 会执行任意工具：保守元数据（非只读、非并发安全）
        meta: { readOnly: false, concurrencySafe: false },
    };
}

/**
 * FR-12 plan 模式：规划-审批-执行工作流工具。
 * 1) 规划阶段：只读工具产出结构化计划 → Planning 事件（durable）
 * 2) 审批：复用 ask_question 交互通道（批准执行 / 取消；自定义输入 = 修订意见）
 * 3) 批准 → 执行阶段（executeTools，按计划落地）；取消 → 终止；修订 → 回到 1（至多 3 轮）
 */
export function createPlanWorkflowTool(): Tool {
    return {
        schema: {
            type: "function",
            function: {
                name: "plan",
                description:
                    "Delegate a complex, multi-step task. Produces a plan (steps/files/risks) for user approval, then executes it after approval. Use for tasks with 3+ distinct steps.",
                parameters: {
                    type: "object",
                    properties: {
                        task: {
                            type: "string",
                            description: "The focused task to plan and execute",
                        },
                    },
                    required: ["task"],
                },
            },
        },
        meta: { readOnly: false, concurrencySafe: false },
        handler: async (args, ctx) => {
            const { task } = args as { task: string };
            const depth = ctx.subagentDepth ?? 0;
            const runId = randomUUID();
            const tagged: EventEmitter = {
                submit: (e) =>
                    ctx.eventStream.submit({ ...e, author: "plan", runId }),
            };
            const subBase = {
                workspace: ctx.workspace,
                signal: ctx.signal,
                llm: ctx.llm,
                fileState: ctx.fileState,
                gitBashPath: ctx.gitBashPath,
                permissions: ctx.permissions,
                snapshot: ctx.snapshot,
                skills: ctx.skills,
                providers: ctx.providers,
            };

            const askApproval = async (planText: string): Promise<string> => {
                const id = randomUUID();
                const answers = new Promise<string[]>((resolve) => {
                    registerInteraction(id, { resolve });
                    ctx.eventStream.submit({
                        type: "Interaction",
                        message: "plan approval",
                        data: {
                            id,
                            questions: [
                                {
                                    question:
                                        "是否批准执行该计划？（自定义输入 = 修订意见，将重新规划）",
                                    header: "PLAN REVIEW",
                                    options: ["批准执行", "取消"],
                                },
                            ],
                        },
                    });
                });
                // 10 分钟无响应按取消（保守；不执行未批准的计划）
                const timeout = new Promise<string[]>((resolve) => {
                    setTimeout(() => {
                        unregisterInteraction(id);
                        resolve(["取消"]);
                    }, 600_000);
                });
                const raced = await Promise.race([answers, timeout]);
                if (!Array.isArray(raced)) {
                    unregisterInteraction(id);
                    return "取消";
                }
                const first = raced[0];
                if (first === "批准执行") return "批准执行";
                if (first === "取消") return "取消";
                return first; // 自定义输入 = 修订意见
            };

            let feedback = "";
            const MAX_ROUNDS = 3;
            for (let round = 1; round <= MAX_ROUNDS; round++) {
                // 1) 规划（只读工具）
                const planMessages: ChatMessage[] = [
                    { role: "system", content: planAgentInstruction },
                    { role: "user", content: feedback ? `${task}\n\n[修订意见（上一版计划被要求修改）]：${feedback}` : task },
                ];
                const planning = await agentLoop(
                    "produce the plan",
                    planMessages,
                    8,
                    {},
                    undefined,
                    {
                        ...subBase,
                        eventStream: tagged,
                        subagentDepth: depth + 1,
                    },
                    ToolKit.allTools.filter((t) => t.meta?.readOnly === true),
                    undefined
                );
                const planText =
                    planning.result ||
                    planMessages
                        .filter((m) => (m as { role?: string }).role !== "system")
                        .map((m) => String((m as { content?: unknown }).content ?? ""))
                        .join("\n")
                        .slice(-4000);

                // 2) 计划入流（durable，回放可见）
                ctx.eventStream.submit({
                    type: "Planning",
                    message: planText,
                    data: { plan: planText, round },
                });

                // 3) 审批
                const answer = await askApproval(planText);
                if (answer === "取消") {
                    return "用户取消了该计划，未执行。";
                }
                if (answer !== "批准执行") {
                    feedback = answer; // 自定义输入 = 修订意见
                    continue;
                }

                // 4) 执行阶段（executeTools，按批准的计划）
                const execMessages: ChatMessage[] = [
                    { role: "system", content: planExecutionInstruction },
                    { role: "user", content: `${task}\n\n[Approved plan]\n${planText}` },
                ];
                const execution = await agentLoop(
                    "execute the approved plan",
                    execMessages,
                    30,
                    {},
                    undefined,
                    {
                        ...subBase,
                        eventStream: tagged,
                        subagentDepth: depth + 1,
                    },
                    ToolKit.executeTools,
                    undefined
                );
                return execution.result;
            }
            return `计划经 ${MAX_ROUNDS} 轮修订仍未批准，已停止。`;
        },
    };
}

/** 预置：主 agent。默认 definition，工具集含 plan 工作流工具。 */
export const mainAgent: AgentDefinition = {
    name: "main",
    description: "",
    instruction: systemPrompt,
    tools: [...ToolKit.allTools, createPlanWorkflowTool()],
};
