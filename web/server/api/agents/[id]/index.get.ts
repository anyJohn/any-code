import { getAgent } from "../../../utils/agentPool";

// GET /api/agents/:id —— agent 元信息（workspacePath / sessionId 等），chat 页顶栏展示用
export default defineEventHandler((event) => {
    const id = getRouterParam(event, "id") as string;
    const agent = getAgent(id);
    if (!agent) {
        throw createError({ statusCode: 404, statusMessage: "Agent not found" });
    }
    const ws = agent.getWorkspace();
    return {
        agentId: id,
        workspacePath: ws.rootPath,
        projectKey: agent.getProjectKey(),
        sessionId: agent.getSession()?.id ?? null,
    };
});
