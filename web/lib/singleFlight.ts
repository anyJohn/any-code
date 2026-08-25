// 同一 session 的并发互斥：/run 与 /compact 共用此 set。
// 挂 globalThis 跨 HMR 保持（Next dev HMR 重建模块但 globalThis 不重置）。
const g = globalThis as unknown as { __anycodeRunning?: Set<string> };

/** 取（必要时创建）跨模块共享的 running session 集合。 */
export function runningSessions(): Set<string> {
    if (!g.__anycodeRunning) g.__anycodeRunning = new Set();
    return g.__anycodeRunning;
}
