import { getAgent } from "../../../utils/agentPool";

// POST /api/agents/:id/messages  body: { task: string }
//   立即 202 语义：agent.submit 入队后马上返回，agentLoop 后台异步跑（最多 30 轮）。
//   事件通过 SSE 推送，HTTP 请求不挂住。
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, "id") as string;
    const agent = getAgent(id);
    if (!agent) {
        throw createError({ statusCode: 404, statusMessage: "Agent not found" });
    }

    const { task } = await readBody<{ task: string }>(event);
    if (!task || !task.trim()) {
        throw createError({ statusCode: 400, statusMessage: "task required" });
    }

    agent.submit(task);
    return { status: "accepted" };
});
