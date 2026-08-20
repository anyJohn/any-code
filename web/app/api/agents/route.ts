import { NextResponse } from "next/server";
import { createAgent } from "@/lib/server/agentPool";

// POST /api/agents  body: { workspacePath, sessionId? } → { id }
// 立即返回 agentId；agentLoop 后台异步跑，事件经 SSE 推送。
export async function POST(req: Request) {
    let body: { workspacePath?: string; sessionId?: string } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    if (!body?.workspacePath) {
        return NextResponse.json(
            { statusMessage: "workspacePath required" },
            { status: 400 }
        );
    }
    const id = await createAgent(body.workspacePath, body.sessionId);
    return NextResponse.json({ id });
}
