import type { ChatCompletionTool } from "openai/resources/index";
import type { ToolContext } from "../context";
import {
    globSchema,
    grepSchema,
    readSchema,
    writeSchema,
    editSchema,
    exploreSchema,
    executeBashSchema,
    saveMemorySchema,
    askQuestionSchema,
    skillSchema,
} from "./schema";
import { executeBashFunc } from "./functions/bash";
import { readFunc } from "./functions/read";
import { editFunc } from "./functions/edit";
import { writeFunc } from "./functions/write";
import { exploreFunc } from "./functions/explore";
import { globFunc } from "./functions/glob";
import { grepFunc } from "./functions/grep";
import { saveMemoryFunc } from "./functions/saveMemory";
import { askQuestionFunc } from "./functions/askQuestion";
import { skillFunc } from "./functions/skill";

/**
 * 工具元数据（AR-7）：缺省按最保守处理（非只读、非并发安全）——
 * 权限默认策略与并行调度均由元数据推导，不手工维护第二份清单。
 */
export interface ToolMeta {
    /** 只读：权限模式默认放行（standard/accept_edits 下 allow） */
    readOnly?: boolean;
    /** 并发安全：同批 tool calls 可与其他并发安全工具并行执行（FR-8） */
    concurrencySafe?: boolean;
}

/**
 * 结构化工具结果（FR-10）：content 给模型（role:tool 结果文本），
 * data 为结构化元数据（exitCode/spillFile/filePath 等）——进 Tool 审计事件
 * 供 UI/系统消费（模型不可见）。handler 返回 string 时等价于 { content }。
 */
export interface ToolResult {
    content: string;
    data?: Record<string, unknown>;
}

/**
 * Tool = schema（给 LLM）+ handler（执行）+ meta（能力声明）。
 * 统一内置工具与 AgentTool，支持按 agent 组合工具集。handler 收 ToolContext。
 */
export interface Tool {
    schema: ChatCompletionTool;
    handler: (args: any, ctx: ToolContext) => Promise<string | ToolResult>;
    meta?: ToolMeta;
}

const bashTool: Tool = {
    schema: executeBashSchema,
    handler: executeBashFunc,
    meta: { readOnly: false, concurrencySafe: false },
};
const readTool: Tool = {
    schema: readSchema,
    handler: readFunc,
    meta: { readOnly: true, concurrencySafe: true },
};
const editTool: Tool = {
    schema: editSchema,
    handler: editFunc,
    meta: { readOnly: false, concurrencySafe: false },
};
const writeTool: Tool = {
    schema: writeSchema,
    handler: writeFunc,
    meta: { readOnly: false, concurrencySafe: false },
};
const exploreTool: Tool = {
    schema: exploreSchema,
    handler: exploreFunc,
    meta: { readOnly: true, concurrencySafe: true },
};
const globTool: Tool = {
    schema: globSchema,
    handler: globFunc,
    meta: { readOnly: true, concurrencySafe: true },
};
const grepTool: Tool = {
    schema: grepSchema,
    handler: grepFunc,
    meta: { readOnly: true, concurrencySafe: true },
};
const saveMemoryTool: Tool = {
    schema: saveMemorySchema,
    handler: saveMemoryFunc,
    meta: { readOnly: true, concurrencySafe: false },
};
const askQuestionTool: Tool = {
    schema: askQuestionSchema,
    handler: askQuestionFunc,
    meta: { readOnly: true, concurrencySafe: false },
};
/** skill 工具：按需读技能全文（SPEC-031 B-005）。只读；模型经 <available_skills> 目录触发。 */
const skillTool: Tool = {
    schema: skillSchema,
    handler: skillFunc,
    meta: { readOnly: true, concurrencySafe: true },
};

// plan 由 AgentTool(planAgent) 提供（见 agent.ts）。
const builtinTools: Tool[] = [
    bashTool,
    readTool,
    editTool,
    writeTool,
    exploreTool,
    globTool,
    grepTool,
    saveMemoryTool,
    askQuestionTool,
    skillTool,
];

const ToolKit = {
    allTools: builtinTools,
    executeTools: builtinTools,
};

export { ToolKit };
