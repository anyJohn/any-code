import { randomUUID } from "node:crypto";
import { agentLoop } from "./core";
import { systemPrompt, planAgentInstruction } from "./prompt";
import { ToolKit } from "./tools";
import type { Tool } from "./tools";
import type { ChatMessage } from "./type";
import type { EventEmitter } from "./context";

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
            const runId = randomUUID();
            const parentStream = ctx.eventStream;
            // tagged proxy：sub-agent 事件转发到父流,打上 author(def.name)+runId。
            // 前端按 runId 分组折叠展示,主流不被淹没但 sub-agent 过程可见。
            const tagged: EventEmitter = {
                submit: (e) =>
                    parentStream.submit({ ...e, author: def.name, runId }),
            };
            const subCtx = {
                workspace: ctx.workspace,
                eventStream: tagged,
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
    };
}

/** 预置：plan sub-agent。可执行（executeTools），不含 plan 本身（防递归委托）。 */
export const planAgent: AgentDefinition = {
    name: "plan",
    description:
        "Delegate a complex, multi-step task. This sub-agent decomposes it into steps, executes each with its tools, and returns a concise summary. Use for tasks with 3+ distinct steps.",
    instruction: planAgentInstruction,
    tools: ToolKit.executeTools,
};

/** 预置：主 agent。默认 definition，工具集含 plan AgentTool。 */
export const mainAgent: AgentDefinition = {
    name: "main",
    description: "",
    instruction: systemPrompt,
    tools: [...ToolKit.allTools, AgentTool(planAgent)],
};
