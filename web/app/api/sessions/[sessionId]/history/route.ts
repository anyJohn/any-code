import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SessionService } from "@any-code/domain";

// GET /api/sessions/:sessionId/history → { messages, projectKey }
// 历史直读盘，不经 agent/pool。findSession 跨项目按 sessionId 反查所属 projectKey，
// 故直链 /chat/:sessionId 无需前端传 workspace 也能解析（C 的点）。
// projectKey 回传前端，用于 setSelected 对应 workspace（/run 需 rootPath）。
export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await ctx.params;
    const service = new SessionService();
    const found = await service.findSession(sessionId);
    if (!found) {
        return NextResponse.json(
            { statusMessage: "session not found" },
            { status: 404 }
        );
    }
    return NextResponse.json({
        messages: found.session.messages,
        projectKey: found.key.projectKey,
    });
}
