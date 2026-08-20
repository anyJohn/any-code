import type { NextRequest } from "next/server";
import { getAgent } from "@/lib/server/agentPool";

// GET /api/agents/:id/events —— SSE 推送 AgentEvent
//   连上时先回灌 eventHistory$ 当前值，之后订阅 eventStream$ 增量。
//   客户端断开（abort）→ 取消订阅，防僵尸订阅。
export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
    const { id } = await ctx.params;
    const agent = getAgent(id);
    if (!agent) {
        return new Response("Agent not found", { status: 404 });
    }

    const headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // 反代不缓冲
    };

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const enc = new TextEncoder();
            const send = (e: unknown) => {
                try {
                    controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
                } catch {
                    // controller 已关闭，忽略
                }
            };

            // 1) 回灌历史
            for (const e of agent.eventHistory$.value) send(e);
            // 2) 订阅增量
            const sub = agent.eventStream$.subscribe(send);

            // 3) 客户端断开 → 取消订阅
            const onAbort = () => {
                sub.unsubscribe();
                try {
                    controller.close();
                } catch {
                    // 已关闭
                }
            };
            req.signal.addEventListener("abort", onAbort, { once: true });
        },
    });

    return new Response(stream, { headers });
}
