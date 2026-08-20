import { NextResponse } from "next/server";
import { SessionService } from "@any-code/domain";

// GET /api/workspaces/:projectKey/sessions —— 该工作区下的会话列表
export async function GET(
    _req: Request,
    ctx: { params: Promise<{ projectKey: string }> }
) {
    const { projectKey } = await ctx.params;
    const service = new SessionService();
    return NextResponse.json(await service.list(projectKey));
}
