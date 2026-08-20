import { NextResponse } from "next/server";
import { getAgent } from "@/lib/server/agentPool";

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
