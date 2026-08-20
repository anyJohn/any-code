import { NextResponse } from "next/server";
import { getAgent, removeAgent } from "@/lib/server/agentPool";

// GET /api/agents/:id → agent 元信息（顶栏/chat 页展示用）
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
    const ws = agent.getWorkspace();
    return NextResponse.json({
        agentId: id,
        workspacePath: ws.rootPath,
        projectKey: agent.getProjectKey(),
        sessionId: agent.getSession()?.id ?? null,
    });
}

// DELETE /api/agents/:id —— 从池中移除并销毁 agent（删当前活动 session 时调用，避免悬空 agent）
export async function DELETE(
    _req: Request,
    ctx: { params: Promise<{ id: string }> }
) {
    const { id } = await ctx.params;
    removeAgent(id);
    return NextResponse.json({ status: "removed" });
}
