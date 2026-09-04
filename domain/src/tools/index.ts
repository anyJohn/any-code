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
import { jobOutputFunc, jobKillFunc } from "./functions/jobs";
import {
    jobOutputSchema,
    jobKillSchema,
} from "./schema";
import { webFetchTool } from "./functions/webFetchTool";
import { webSearchTool } from "./functions/webSearchTool";
import { browserUseTool } from "./functions/browserUseTool";
import { createSkillTool } from "./functions/createSkillTool";

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
// save_memory 写技能/记忆文件（用户指正 2026-09-04：会操控本地文件，非只读）
const saveMemoryTool: Tool = {
    schema: saveMemorySchema,
    handler: saveMemoryFunc,
    meta: { readOnly: false, concurrencySafe: false },
};
const askQuestionTool: Tool = {
    schema: askQuestionSchema,
    handler: askQuestionFunc,
    meta: { readOnly: true, concurrencySafe: false },
};
/** 后台任务工具（FR-13）：job_output 只读可并行；job_kill 杀进程（非只读） */
const jobOutputTool: Tool = {
    schema: jobOutputSchema,
    handler: jobOutputFunc,
    meta: { readOnly: true, concurrencySafe: true },
};
const jobKillTool: Tool = {
    schema: jobKillSchema,
    handler: jobKillFunc,
    meta: { readOnly: false, concurrencySafe: false },
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
    createSkillTool,
    jobOutputTool,
    jobKillTool,
    // web 原生工具（用户决策 2026-09-03：取代内置 MCP 连接器；代理走全局 dispatcher）
    webFetchTool,
    webSearchTool,
    browserUseTool,
];

const ToolKit = {
    allTools: builtinTools,
    executeTools: builtinTools,
};

export { ToolKit };

/** 工具目录条目：Settings 面板 / config.tools 键位展示用。 */
export interface ToolCatalogEntry {
    name: string;
    description: string;
    readOnly: boolean;
}

/** 全部内置工具目录（注册序）。 */
export function toolCatalog(): ToolCatalogEntry[] {
    return builtinTools.map((t) => ({
        name: (t.schema as { function?: { name?: string } }).function?.name ?? "?",
        description:
            (t.schema as { function?: { description?: string } }).function
                ?.description ?? "",
        readOnly: t.meta?.readOnly === true,
    }));
}

/**
 * 按通用工具开关过滤（用户决策 2026-09-03）：config.tools.<名>.enabled === false
 * → 剔除（LLM 不可见、不可调用）；未配置 = 启用。对全部工具生效（含扩展/MCP 注入的）。
 */
export function filterEnabledTools(
    tools: Tool[],
    toolsConfig: Record<string, import("../config").ToolConfigEntry> | undefined
): Tool[] {
    return tools.filter((t) => {
        const n = (t.schema as { function?: { name?: string } }).function?.name;
        if (!n) return true; // 无名工具（防御）保留
        return toolsConfig?.[n]?.enabled !== false;
    });
}
