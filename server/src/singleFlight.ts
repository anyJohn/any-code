// 同一 session 的并发互斥：/run 与 /compact 共用此 set。
// 从 web/lib/singleFlight.ts 迁来（Next 版挂 globalThis 跨 HMR；server 单进程，模块级 Set 即可，
// 但保留 globalThis 形式以与未来 Electron main 共享同一语义）。
const g = globalThis as unknown as {
    __anycodeRunning?: Set<string>;
    __anycodeRunningWs?: Set<string>;
};

/** 取（必要时创建）跨模块共享的 running session 集合。 */
export function runningSessions(): Set<string> {
    if (!g.__anycodeRunning) g.__anycodeRunning = new Set();
    return g.__anycodeRunning;
}

/** 工作区占用集合（AR-4 #6）：/run 期间标记，rollback 拒绝与运行中 agent 竞态。 */
export function runningWorkspaces(): Set<string> {
    if (!g.__anycodeRunningWs) g.__anycodeRunningWs = new Set();
    return g.__anycodeRunningWs;
}
