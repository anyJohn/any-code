import { WorkspaceRegistry } from "@any-code/domain";

// DELETE /api/workspaces  body: { path: string } —— 从注册表移除工作区（不删磁盘文件）
export default defineEventHandler(async (event) => {
    const body = await readBody<{ path?: string }>(event);
    const p = body?.path?.trim();
    if (!p) {
        throw createError({ statusCode: 400, statusMessage: "path required" });
    }
    WorkspaceRegistry.remove(p);
    return { status: "removed" };
});
