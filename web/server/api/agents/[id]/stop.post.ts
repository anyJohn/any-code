import { getAgent } from "../../../utils/agentPool";

// POST /api/agents/:id/stop —— 触发 agent.stop()，即 stop$.next()，中断当前任务
export default defineEventHandler((event) => {
    const id = getRouterParam(event, "id") as string;
    const agent = getAgent(id);
    if (!agent) {
        throw createError({ statusCode: 404, statusMessage: "Agent not found" });
    }
    agent.stop();
    return { status: "stopped" };
});
