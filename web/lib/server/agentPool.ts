import "server-only";
import { randomUUID } from "node:crypto";
import { AnyAgent, WorkspaceRegistry } from "@any-code/domain";

// EventStream 是全局单例（eventStream.ts 的 getInstance()），多 agent 并发会串流。
// P0 单用户单 agent 可用；多用户前需改 per-agent。

// ⚠️ 池必须挂在 globalThis 上：Next dev 下，不同 Route Handler 文件
// （POST /api/agents 的 route.ts 与 GET /api/agents/[id] 的 [id]/route.ts）
// 会被编译成各自独立的模块图，模块级 const Map 会在每条路由各实例化一份，
// 导致 POST 写入的 agent 在 GET 里读不到（404）。挂到 globalThis 后，
// 无论哪条路由、无论 HMR 重载几次，读写的都是同一个 Map。生产环境同样适用。
const globalForPool = globalThis as unknown as {
    __anycodeAgentPool?: Map<string, AnyAgent>;
    __anycodeAgentLastUsed?: Map<string, number>;
};
const pool: Map<string, AnyAgent> =
    globalForPool.__anycodeAgentPool ??
    (globalForPool.__anycodeAgentPool = new Map());
const lastUsed: Map<string, number> =
    globalForPool.__anycodeAgentLastUsed ??
    (globalForPool.__anycodeAgentLastUsed = new Map());
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

/** 仅供测试：直接注入 mock agent。 */
export function __setAgentForTest(id: string, agent: AnyAgent) {
    pool.set(id, agent);
    lastUsed.set(id, Date.now());
}

/** 仅供测试：清空池。 */
export function __clearPoolForTest() {
    for (const a of pool.values()) a.destroy();
    pool.clear();
    lastUsed.clear();
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
