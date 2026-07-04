import { randomUUID } from "node:crypto";
import type { AnyAgent } from "@any-code/domain";
import { AnyAgent, WorkspaceRegistry } from "@any-code/domain";

// EventStream 是全局单例（eventStream.ts 的 getInstance()），多 agent 并发会串流。
// P0 单用户单 agent 可用；多用户前需改 per-agent。

const pool = new Map<string, AnyAgent>();
const lastUsed = new Map<string, number>();
const IDLE_TTL_MS = 30 * 60 * 1000;

/** 在指定工作区下新建或恢复 agent，入池，返回 agentId（路由 key）。 */
export async function createAgent(
    workspacePath: string,
    sessionId?: string
): Promise<string> {
    const id = randomUUID();
    const agent = await AnyAgent.create({
        rootPath: workspacePath,
        sessionId,
    });
    pool.set(id, agent);
    lastUsed.set(id, Date.now());
    // 切换到该工作区 → 刷新注册表 lastUsedAt（驱动侧栏"最近"排序）
    WorkspaceRegistry.touch(agent.getWorkspace().rootPath);
    return id;
}

export function getAgent(id: string): AnyAgent | null {
    const agent = pool.get(id);
    if (agent) lastUsed.set(id, Date.now());
    return agent ?? null;
}

// 闲置 TTL 回收：destroy() 拆 agent 的 rxjs 订阅（stop$ + destroy$），防内存泄漏。
const reaper = setInterval(() => {
    const now = Date.now();
    for (const [id, t] of lastUsed) {
        if (now - t > IDLE_TTL_MS) {
            pool.get(id)?.destroy();
            pool.delete(id);
            lastUsed.delete(id);
        }
    }
}, 5 * 60 * 1000);
reaper.unref?.();
