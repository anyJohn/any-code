import { NextResponse } from "next/server";
import { getAgent } from "@/lib/server/agentPool";

// POST /api/agents/:id/stop —— 触发 agent.stop()（stop$.next + abort），中断当前任务
export async function POST(
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
    agent.stop();
    return NextResponse.json({ status: "stopped" });
}
