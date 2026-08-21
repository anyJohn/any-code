import { NextResponse } from "next/server";
import { SessionService, projectKeyOf } from "@any-code/domain";

// POST /api/sessions  body: { workspacePath } → { sessionId, projectKey } (201)
// 两步法建 session：点"新建对话"不调服务端；首条消息时调此端点建 session，
// 前端 replaceState 到 /chat/{sessionId} 后再 POST /api/sessions/:sessionId/run 流式跑。
// 标题先占位 "New Session"，由 /run 首任务时 setTitle 改成 task 文本（沿用既有逻辑）。
export async function POST(req: Request) {
    let body: { workspacePath?: string } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    const workspacePath = body?.workspacePath?.trim();
    if (!workspacePath) {
        return NextResponse.json(
            { statusMessage: "workspacePath required" },
            { status: 400 }
        );
    }
    const projectKey = projectKeyOf(workspacePath);
    const service = new SessionService();
    const session = await service.create(projectKey, "New Session");
    return NextResponse.json(
        { sessionId: session.id, projectKey },
        { status: 201 }
    );
}
