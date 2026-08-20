import { NextResponse } from "next/server";
import { SessionService, type SessionKey } from "@any-code/domain";

// DELETE /api/workspaces/:projectKey/sessions/:sessionId —— 删除 session 磁盘文件
// domain SessionService.remove 对不存在的文件静默（幂等）。与 agentPool 解耦。
export async function DELETE(
    _req: Request,
    ctx: { params: Promise<{ projectKey: string; sessionId: string }> }
) {
    const { projectKey, sessionId } = await ctx.params;
    const service = new SessionService();
    await service.remove(projectKey, sessionId);
    return NextResponse.json({ status: "removed" });
}

// PATCH /api/workspaces/:projectKey/sessions/:sessionId  body: { title }
// 重命名：追加一条 title meta（entriesToSession 取末条 meta 为准）。不改旧行。
export async function PATCH(
    req: Request,
    ctx: { params: Promise<{ projectKey: string; sessionId: string }> }
) {
    const { projectKey, sessionId } = await ctx.params;
    let body: { title?: string } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    const title = body?.title?.trim();
    if (!title) {
        return NextResponse.json(
            { statusMessage: "title required" },
            { status: 400 }
        );
    }
    const key: SessionKey = { projectKey, sessionId };
    const service = new SessionService();
    await service.setTitle(key, title);
    return NextResponse.json({ status: "renamed", title });
}
