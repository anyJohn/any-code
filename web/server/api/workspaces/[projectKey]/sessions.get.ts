import { SessionService } from "@any-code/domain";

// GET /api/workspaces/:projectKey/sessions —— 该工作区下的会话列表
export default defineEventHandler(async (event) => {
    const projectKey = getRouterParam(event, "projectKey") as string;
    const service = new SessionService();
    return service.list(projectKey);
});
