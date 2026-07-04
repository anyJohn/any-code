import { getAgent } from "../../../utils/agentPool";

// GET /api/agents/:id/events —— SSE 推送 AgentEvent
//   连上时先回灌 eventHistory$ 当前值，之后订阅 eventStream$ 增量。
//   对应 domain 的 BehaviorSubject（history$）+ Observable（event$）语义。
export default defineEventHandler((event) => {
    const id = getRouterParam(event, "id") as string;
    const agent = getAgent(id);
    if (!agent) {
        throw createError({ statusCode: 404, statusMessage: "Agent not found" });
    }

    setResponseHeader(event, "Content-Type", "text/event-stream");
    setResponseHeader(event, "Cache-Control", "no-cache");
    setResponseHeader(event, "Connection", "keep-alive");
    setResponseHeader(event, "X-Accel-Buffering", "no"); // 反代不缓冲

    const res = event.node.res;
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);

    // 1) 回灌历史
    for (const e of agent.eventHistory$.value) send(e);
    // 2) 订阅增量
    const sub = agent.eventStream$.subscribe(send);

    // 3) 客户端断开 → 取消订阅，防僵尸订阅（等价 TUI 里 useEffect 的 cleanup）
    return new Promise<void>((resolve) => {
        event.node.req.on("close", () => {
            sub.unsubscribe();
            resolve();
        });
    });
});
