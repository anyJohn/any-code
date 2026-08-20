import { NextResponse } from "next/server";
import { getAgent } from "@/lib/server/agentPool";

// GET /api/agents/:id/history —— 返回 session.messages（resume 回显历史）
//   session 延迟创建：首条消息前 getSession() 为 null，此时返回空数组。
export async function GET(
    _req: Request,
    ctx: { params: Promise<{ id: string }> }
) {
    const { id } = await ctx.params;
    const agent = getAgent(id);
    if (!agent) {
        return NextResponse.json(
            { statusMessage: "Agent not found" },
            { status: 404 }
        );
    }
    return NextResponse.json(agent.getSession()?.messages ?? []);
}
