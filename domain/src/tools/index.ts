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
} from "./schema";
import { executeBashFunc } from "./functions/bash";
import { readFunc } from "./functions/read";
import { editFunc } from "./functions/edit";
import { writeFunc } from "./functions/write";
import { exploreFunc } from "./functions/explore";
import { globFunc } from "./functions/glob";
import { grepFunc } from "./functions/grep";

/**
 * Tool = schema（给 LLM）+ handler（执行）。统一内置工具与 AgentTool，
 * 支持按 agent 组合工具集。handler 收 ToolContext（workspace + eventStream）。
 */
export interface Tool {
    schema: ChatCompletionTool;
    handler: (args: any, ctx: ToolContext) => Promise<string>;
}

const bashTool: Tool = { schema: executeBashSchema, handler: executeBashFunc };
const readTool: Tool = { schema: readSchema, handler: readFunc };
const editTool: Tool = { schema: editSchema, handler: editFunc };
const writeTool: Tool = { schema: writeSchema, handler: writeFunc };
const exploreTool: Tool = { schema: exploreSchema, handler: exploreFunc };
const globTool: Tool = { schema: globSchema, handler: globFunc };
const grepTool: Tool = { schema: grepSchema, handler: grepFunc };

// plan 不再是 builtin——它由 AgentTool(planAgent) 提供（见 agent.ts）。
const ToolKit = {
    allTools: [bashTool, readTool, editTool, writeTool, exploreTool, globTool, grepTool],
    readOnlyTools: [readTool, exploreTool, globTool, grepTool],
    executeTools: [
        bashTool,
        readTool,
        editTool,
        writeTool,
        exploreTool,
        globTool,
        grepTool,
    ],
};

export { ToolKit };
