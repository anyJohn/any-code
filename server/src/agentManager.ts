import {
    AnyAgent,
    Config,
    DURABLE_TYPES,
    type AgentEvent,
    type SessionKey,
} from "@any-code/domain";
import { runningSessions, runningWorkspaces } from "./singleFlight.js";

/**
 * AgentManager（FR-30 / SPEC-033）：server 侧运行中 agent 托管表。
 *
 * 职责：agent 存活期与客户端连接解耦（断开只移除订阅者）；per-run 事件序号 +
 * 订阅者扇出（/run 首订与 /stream 重挂共用）；pending ask 状态跟踪；显式 stop；
 * 全局并发闸（maxConcurrentRuns，满载排队）；进程退出统一清理。
 *
 * 序号语义：per-run 单调递增（0 起，等于 agent.eventHistory$ 下标）；跨 run 由
 * "重挂 404 → 客户端 /history 全量刷新"衔接（run 结束即 destroy 出表）。
 *
 * 生命周期：register（run 开始，占用 runningSessions/runningWorkspaces 标记）
 * → 终态事件 → finalize（destroy + 清标记 + 出表 + 释放并发槽）。
 * 单飞预留仍由 route 经 runningSessions 先占（与 /compact 共用，防 create 窗口并发）。
 */

/** 终态事件类型（done / error / stopped，SPEC-031）。 */
export const TERMINAL = new Set(["Done", "Error", "Stopped"]);

/** SSE 事件帧：seq 为 per-run 单调序号，event 为 domain 原始事件。 */
export interface StreamFrame {
    seq: number;
    event: AgentEvent;
}

/** 会话运行状态（会话列表徽标 / 跨会话 ask 提醒用）。 */
export type RunStatus = "queued" | "running" | "waiting_ask";

export interface RunEntry {
    agent: AnyAgent;
    sessionId: string;
    projectKey: string;
    workspacePath: string;
    startedAt: number;
    /** SSE 订阅者推送函数集合（/run 首订与 /stream 重挂都挂这里） */
    subscribers: Set<(frame: StreamFrame) => void>;
    /** 当前 pending 权限 ask（PermissionAsk 事件置位 / Permission decided 复位） */
    pendingAsk: { id: string; tool: string; summary: string } | null;
    /** 内部事件订阅（终态 finalize 时拆） */
    unsubscribe: () => void;
}

export interface RunStatusInfo {
    sessionId: string;
    projectKey: string;
    status: RunStatus;
    pendingAsk: { id: string; tool: string; summary: string } | null;
    startedAt: number;
}

/** 并发上限读取：config.maxConcurrentRuns（坏 config 兜底 3，与 DEFAULT_MAX_CONCURRENT_RUNS 一致）。 */
function defaultMaxRuns(): number {
    try {
        return Config.load().maxConcurrentRuns;
    } catch {
        return 3;
    }
}

export class AgentManager {
    private runs = new Map<string, RunEntry>();
    /** 并发闸排队表：sessionId → { projectKey, 唤醒 resolver }（FIFO 按插入序） */
    private queue = new Map<string, { projectKey: string; resolve: () => void }>();
    /** 已授予（含排队中被唤醒尚未 register）的槽位数——防"唤醒到注册窗口"被新 acquire 抢槽 */
    private active = 0;

    /** maxRunsFn 可注入（测试）；缺省读 config。 */
    constructor(private maxRunsFn: () => number = defaultMaxRuns) {}

    // ── 查询 ──

    get(sessionId: string): RunEntry | undefined {
        return this.runs.get(sessionId);
    }

    isBusy(sessionId: string): boolean {
        return this.runs.has(sessionId) || this.queue.has(sessionId);
    }

    /** 并发闸当前是否还有空位（route 用来决定是否发"排队中"提示帧）。 */
    hasFreeSlot(): boolean {
        return this.maxRunsFn() === 0 || this.active < this.maxRunsFn();
    }

    /** 全部运行/排队会话的状态快照（会话列表徽标 + pending ask 提醒）。 */
    statusList(): RunStatusInfo[] {
        const out: RunStatusInfo[] = [];
        for (const [sessionId, e] of this.runs) {
            out.push({
                sessionId,
                projectKey: e.projectKey,
                status: e.pendingAsk ? "waiting_ask" : "running",
                pendingAsk: e.pendingAsk,
                startedAt: e.startedAt,
            });
        }
        for (const [sessionId, q] of this.queue) {
            out.push({
                sessionId,
                projectKey: q.projectKey,
                status: "queued",
                pendingAsk: null,
                startedAt: 0,
            });
        }
        return out;
    }

    // ── 并发闸 ──

    /**
     * 占一个并发槽，返回释放函数（route 失败路径调用）。满载排队等待唤醒；
     * 0 = 不限（no-op release）。唤醒到 register 之间槽位已计入 active，不会被新 acquire 抢走。
     */
    async acquire(sessionId: string, projectKey: string): Promise<() => void> {
        const max = this.maxRunsFn();
        if (max === 0) return () => {};
        if (this.active < max) {
            this.active++;
            return () => this.releaseSlot();
        }
        await new Promise<void>((resolve) =>
            this.queue.set(sessionId, { projectKey, resolve }),
        );
        this.active++; // 唤醒即视为授予（releaseSlot 已先减）
        return () => this.releaseSlot();
    }

    /** 释放槽位并唤醒队首（FIFO，Map 插入序）。 */
    private releaseSlot(): void {
        this.active = Math.max(0, this.active - 1);
        const next = this.queue.entries().next();
        if (next.done) return;
        const [id, q] = next.value;
        this.queue.delete(id);
        q.resolve();
    }

    /** 取消排队（客户端在排队期间断开 / 显式停止排队任务）。 */
    cancelQueued(sessionId: string): boolean {
        return this.queue.delete(sessionId);
    }

    // ── 运行注册表 ──

    /** 注册运行中 agent：接内部订阅（序号/扇出/持久化/ask 跟踪/终态 finalize）。 */
    register(agent: AnyAgent, sessionId: string, workspacePath: string): RunEntry {
        const projectKey = agent.getProjectKey();
        runningWorkspaces().add(projectKey);
        // create 阶段（submit 前）已产生的事件进 history 但无 live 帧；live 序号从 history 长度续起
        let seq = agent.eventHistory$.value.length;
        const entry: RunEntry = {
            agent,
            sessionId,
            projectKey,
            workspacePath,
            startedAt: Date.now(),
            subscribers: new Set(),
            pendingAsk: null,
            unsubscribe: () => {},
        };
        const sub = agent.eventStream$.subscribe(async (e: AgentEvent) => {
            const frame: StreamFrame = { seq: seq++, event: e };
            for (const s of entry.subscribers) s(frame);
            // durable 事件落盘（原 /run 职责迁入：任何订阅者断开都不影响持久化）
            if (e?.type && DURABLE_TYPES.has(e.type)) {
                const key: SessionKey = { projectKey, sessionId };
                try {
                    await agent.getService().appendEvent(key, e);
                } catch {
                    // 写盘失败不阻断流
                }
            }
            if (e?.type === "PermissionAsk") {
                const d = e.data as { id?: string; tool?: string; summary?: string };
                if (d?.id)
                    entry.pendingAsk = { id: d.id, tool: d.tool ?? "", summary: d.summary ?? "" };
            }
            if (
                e?.type === "Permission" &&
                (e.data as { phase?: string })?.phase === "decided"
            ) {
                entry.pendingAsk = null;
            }
            if (e?.type && TERMINAL.has(e.type)) this.finalize(entry);
        });
        entry.unsubscribe = () => sub.unsubscribe();
        this.runs.set(sessionId, entry);
        return entry;
    }

    /** 订阅运行帧（/run 首订与 /stream 重挂共用）。返回退订函数。 */
    addSubscriber(sessionId: string, fn: (frame: StreamFrame) => void): () => void {
        const entry = this.runs.get(sessionId);
        if (!entry) return () => {};
        entry.subscribers.add(fn);
        return () => entry.subscribers.delete(fn);
    }

    /** 显式停止：running → agent.stop()（终态经 Stopped → finalize）；queued → 出队。 */
    stop(sessionId: string): "stopping" | "cancelled" | null {
        const entry = this.runs.get(sessionId);
        if (entry) {
            entry.agent.stop();
            return "stopping";
        }
        return this.cancelQueued(sessionId) ? "cancelled" : null;
    }

    /** 终态收尾：拆内部订阅 → destroy → 清标记/出表 → 释放并发槽。 */
    private finalize(entry: RunEntry): void {
        if (!this.runs.has(entry.sessionId)) return; // 重入守卫
        this.runs.delete(entry.sessionId);
        entry.unsubscribe();
        entry.agent.destroy();
        runningSessions().delete(entry.sessionId);
        runningWorkspaces().delete(entry.projectKey);
        this.releaseSlot();
    }

    /** 进程退出清理（SIGINT/SIGTERM）：全部 destroy，不留孤儿子进程/连接。 */
    stopAll(): void {
        for (const entry of this.runs.values()) {
            try {
                entry.agent.destroy();
            } catch {
                // 退出路径尽力而为
            }
        }
        this.runs.clear();
        for (const q of this.queue.values()) q.resolve();
        this.queue.clear();
    }
}

// 单例（与 singleFlight 同模式：server 单进程；globalThis 便于未来 Electron main 共享）
const g = globalThis as unknown as { __anycodeAgentManager?: AgentManager };

/** 取（必要时创建）跨模块共享的 AgentManager。 */
export function getAgentManager(): AgentManager {
    if (!g.__anycodeAgentManager) g.__anycodeAgentManager = new AgentManager();
    return g.__anycodeAgentManager;
}
