import { getAgent } from "../../../utils/agentPool";

// GET /api/agents/:id/history —— 返回 session.messages（resume 时回显历史用）
//   session 延迟创建：首条消息前 getSession() 为 null，此时返回空数组。
export default defineEventHandler((event) => {
    const id = getRouterParam(event, "id") as string;
    const agent = getAgent(id);
    if (!agent) {
        throw createError({ statusCode: 404, statusMessage: "Agent not found" });
    }
    return agent.getSession()?.messages ?? [];
});
