// Nitro 自动导入 h3 工具：defineEventHandler / readBody / getRouterParam / setResponseHeader / createError
import { createAgent } from "../../utils/agentPool";

// POST /api/agents  body: { workspacePath: string, sessionId?: string }
//   在指定工作区下建 agent；有 sessionId 则恢复历史。立即返回 agentId，
//   agentLoop 后台异步跑，事件经 SSE 推送。
export default defineEventHandler(async (event) => {
    const body = await readBody<{
        workspacePath?: string;
        sessionId?: string;
    }>(event);
    if (!body?.workspacePath) {
        throw createError({
            statusCode: 400,
            statusMessage: "workspacePath required",
        });
    }
    const id = await createAgent(body.workspacePath, body.sessionId);
    return { id };
});
