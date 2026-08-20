import { NextResponse } from "next/server";
import { getAgent } from "@/lib/server/agentPool";

// POST /api/agents/:id/messages  body: { task }
//   立即 202 语义：agent.submit 入队后马上返回，agentLoop 后台异步跑。
export async function POST(
    req: Request,
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

    let body: { task?: string } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    if (!body.task || !body.task.trim()) {
        return NextResponse.json(
            { statusMessage: "task required" },
            { status: 400 }
        );
    }

    agent.submit(body.task);
    return NextResponse.json({ status: "accepted" });
}
