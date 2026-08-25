import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AnyAgent } from "@any-code/domain";
import { runningSessions } from "@/lib/singleFlight";

const running = runningSessions();

const TERMINAL = new Set(["Done", "Error", "Stopped"]);

// POST /api/sessions/:sessionId/run  body: { task, workspacePath } → SSE 流
// 目标 C：agent 连接持有，连接结束（终态事件 / 客户端断开）= destroy。
// 客户端断开（关页面 / abort）= destroy = abort 在途 LLM + 拆订阅 → 任务真停，不在后台继续。
export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
    const { sessionId } = await ctx.params;
    let body: { task?: string; workspacePath?: string } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    const task = body?.task?.trim();
    const workspacePath = body?.workspacePath?.trim();
    if (!task) {
        return NextResponse.json(
            { statusMessage: "task required" },
            { status: 400 }
        );
    }
    if (!workspacePath) {
        return NextResponse.json(
            { statusMessage: "workspacePath required" },
            { status: 400 }
        );
    }

    if (running.has(sessionId)) {
        return NextResponse.json(
            { statusMessage: "session already running" },
            { status: 409 }
        );
    }
    running.add(sessionId);

    const agent = await AnyAgent.create({ rootPath: workspacePath, sessionId });
    if (!agent.getSession()) {
        // sessionId 在盘上不存在（被删 / 直链无效）→ 不静默新建，404。
        running.delete(sessionId);
        agent.destroy();
        return NextResponse.json(
            { statusMessage: "session not found" },
            { status: 404 }
        );
    }

    const headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    };

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const enc = new TextEncoder();
            let sub: { unsubscribe: () => void } | null = null;
            let closed = false;

            const send = (e: unknown) => {
                if (closed) return;
                try {
                    controller.enqueue(
                        enc.encode(`data: ${JSON.stringify(e)}\n\n`)
                    );
                } catch {
                    // controller 已关
                }
            };
            const finish = () => {
                if (closed) return;
                closed = true;
                clearInterval(keepalive);
                sub?.unsubscribe();
                running.delete(sessionId);
                agent.destroy(); // 关连接=destroy=abort 在途 LLM + 拆订阅
                try {
                    controller.close();
                } catch {
                    // 已关
                }
            };

            // SSE keepalive：静默期（如 bash 跑长命令无输出、LLM 长思考）每 15s 注入
            // comment frame（": keepalive\n\n"），前端 parseSSE 忽略非 data: 行，天然兼容。
            // 防 proxy/浏览器因无数据断连，也保"连接活着"的视觉信号。SPEC-018 B-005
            const keepalive = setInterval(() => {
                if (closed) return;
                try {
                    controller.enqueue(enc.encode(": keepalive\n\n"));
                } catch {
                    // controller 已关
                }
            }, 15000);

            // 1) 回灌历史（per-task agent 通常为空，历史由 /history 单独读盘；保留防御）
            for (const e of agent.eventHistory$.value) send(e);
            // 2) 订阅增量，终态收尾
            sub = agent.eventStream$.subscribe((e: { type?: string }) => {
                send(e);
                if (e?.type && TERMINAL.has(e.type)) finish();
            });
            // 3) 客户端断开（关页面/abort）→ finish → destroy → 真停
            req.signal.addEventListener("abort", finish, { once: true });
            // 4) 起任务（fire-and-forget，事件经订阅泵出）
            agent.submit(task);
        },
    });

    return new Response(stream, { headers });
}
