import type { AnyAgent } from "../src/main";
import type { AgentEvent } from "../src/type";

/**
 * eval 任务接口（FR-28）：每个任务 = 指令 + checker（确定性断言，不用 LLM judge）。
 * checker 拿到 agent 事件流与 workspace 根路径，返回 pass/fail + 说明。
 */
export interface EvalTask {
    id: string;
    name: string;
    /** 发给 agent 的任务文本 */
    instruction: string;
    /** 单任务超时 ms（超时 stop 并判 fail） */
    timeoutMs?: number;
    check: (ctx: {
        events: AgentEvent[];
        workspaceRoot: string;
        interactionAnswer: (id: string, answers: string[]) => boolean;
    }) => Promise<{ pass: boolean; detail: string }>;
    /** 任务开始前在 workspace 内放置夹具文件 */
    setup?: (workspaceRoot: string) => void;
}

export interface EvalResult {
    id: string;
    name: string;
    pass: boolean;
    detail: string;
    /** 任务耗时 ms */
    durationMs: number;
    /** 本次任务的 usage tokens 总量（若有 Usage 事件） */
    tokens: number;
}

/** 从事件流提取最终 assistant 消息文本 */
export function finalAssistant(events: AgentEvent[]): string {
    const assistant = events.filter((e) => e.type === "Assistant");
    return (assistant.at(-1) as { message?: string } | undefined)?.message ?? "";
}

/** 事件流里出现过的工具名集合 */
export function toolsUsed(events: AgentEvent[]): Set<string> {
    return new Set(
        events
            .filter((e) => e.type === "Tool")
            .map((e) => (e.data as { name?: string }).name ?? "")
    );
}

export type { AnyAgent };
