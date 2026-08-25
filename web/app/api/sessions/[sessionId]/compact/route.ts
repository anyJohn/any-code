import { NextResponse } from "next/server";
import { AnyAgent } from "@any-code/domain";
import { runningSessions } from "@/lib/singleFlight";

// POST /api/sessions/:sessionId/compact  body: { workspacePath, focus? }
// 手动压缩当前 session 上下文。与 /run 互斥（single-flight）：一方在跑另一方 409。
// 不走 agentLoop；一次性 create → compact → destroy。本路由只用 req.json()，故签 Request。
export async function POST(
    req: Request,
    ctx: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
    const { sessionId } = await ctx.params;
    let body: { focus?: string; workspacePath?: string } = {};
    try {
        body = await req.json();
    } catch {
        // 空 body 允许（无 focus 的压缩）；workspacePath 必填在下面校验
    }
    const workspacePath = body?.workspacePath?.trim();
    if (!workspacePath) {
        return NextResponse.json(
            { statusMessage: "workspacePath required" },
            { status: 400 }
        );
    }

    const running = runningSessions();
    if (running.has(sessionId)) {
        return NextResponse.json(
            { statusMessage: "session is running" },
            { status: 409 }
        );
    }
    running.add(sessionId);
    try {
        const agent = await AnyAgent.create({
            rootPath: workspacePath,
            sessionId,
        });
        if (!agent.getSession()) {
            agent.destroy();
            return NextResponse.json(
                { statusMessage: "session not found" },
                { status: 404 }
            );
        }
        const focus = body?.focus?.trim() || undefined;
        const res = await agent.compact(focus);
        agent.destroy();
        return NextResponse.json(res);
    } catch (err) {
        return NextResponse.json(
            {
                statusMessage: "compact failed",
                error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 }
        );
    } finally {
        running.delete(sessionId);
    }
}
