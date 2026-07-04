import fs from "node:fs";
import { WorkspaceRegistry } from "@any-code/domain";

// POST /api/workspaces  body: { path: string } —— 注册一个工作区目录
export default defineEventHandler(async (event) => {
    const body = await readBody<{ path?: string }>(event);
    const p = body?.path?.trim();
    if (!p) {
        throw createError({ statusCode: 400, statusMessage: "path required" });
    }
    try {
        const stat = fs.statSync(p);
        if (!stat.isDirectory()) {
            throw createError({
                statusCode: 400,
                statusMessage: "not a directory",
            });
        }
    } catch (e) {
        throw createError({
            statusCode: 400,
            statusMessage: `path not accessible: ${e instanceof Error ? e.message : ""}`,
        });
    }
    return WorkspaceRegistry.add(p);
});
