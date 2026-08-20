import type { AgentEvent, ToolCallData } from "./sseEvents";

// 渲染项：回合块 / sub-agent 分组 / 单事件
export interface TurnItem {
    kind: "turn";
    turnId: string;
    iteration?: AgentEvent;
    assistant?: AgentEvent;
    tools: AgentEvent[];
}
export interface SubagentItem {
    kind: "subagent";
    runId: string;
    author: string;
    events: AgentEvent[];
}
export interface SingleItem {
    kind: "single";
    event: AgentEvent;
}
export type RenderItem = TurnItem | SubagentItem | SingleItem;

/**
 * 把一段事件流按回合分组：ITERATION 开新回合，ASSISTANT/TOOL 入当前回合，
 * System/User/Done/Error 单条。sub-agent（带 runId）事件不在此处理——
 * 调用方先按 runId 切出 sub-agent 段，再对主流 / sub-agent 内部各自调本函数。
 */
export function groupByTurn(events: AgentEvent[]): TurnItem[] {
    const items: TurnItem[] = [];
    let cur: TurnItem | null = null;
    const flush = () => {
        if (cur && (cur.assistant || cur.tools.length || cur.iteration)) {
            items.push(cur);
        }
        cur = null;
    };
    for (const e of events) {
        if (e.type === "Iteration") {
            flush();
            cur = { kind: "turn", turnId: e.turnId ?? "", iteration: e, tools: [] };
        } else if (e.type === "Assistant") {
            if (cur && !cur.assistant && !cur.tools.length) {
                cur.assistant = e;
            } else {
                flush();
                cur = { kind: "turn", turnId: e.turnId ?? "", assistant: e, tools: [] };
            }
        } else if (e.type === "Tool") {
            if (!cur) cur = { kind: "turn", turnId: e.turnId ?? "", tools: [] };
            cur.tools.push(e);
        } else {
            flush();
        }
    }
    flush();
    return items;
}

/**
 * 把扁平 events 切成渲染项：主流按回合块、sub-agent 按 runId 成块、其余单条。
 * sub-agent 事件穿插在父回合中间时，会打断父回合——可接受：sub-agent 块自然
 * 落在父回合的 assistant 文本与 tool 结果之间。
 */
export function toRenderItems(events: AgentEvent[]): RenderItem[] {
    const items: RenderItem[] = [];
    let mainBuf: AgentEvent[] = [];
    let sub: { runId: string; author: string; events: AgentEvent[] } | null = null;
    const flushMain = () => {
        for (const t of groupByTurn(mainBuf)) items.push(t);
        mainBuf = [];
    };
    const flushSub = () => {
        if (sub) {
            items.push({
                kind: "subagent",
                runId: sub.runId,
                author: sub.author,
                events: sub.events,
            });
        }
        sub = null;
    };
    for (const e of events) {
        if (e.runId) {
            flushMain();
            if (sub && sub.runId === e.runId) {
                sub.events.push(e);
            } else {
                flushSub();
                sub = {
                    runId: e.runId,
                    author: e.author ?? "sub-agent",
                    events: [e],
                };
            }
        } else if (
            e.type === "System" ||
            e.type === "User" ||
            e.type === "Done" ||
            e.type === "Stopped" ||
            e.type === "Error"
        ) {
            flushMain();
            flushSub();
            items.push({ kind: "single", event: e });
        } else {
            flushSub();
            mainBuf.push(e);
        }
    }
    flushMain();
    flushSub();
    return items;
}

/** 工具调用摘要：按工具名挑最相关参数（参数字段名见 domain/src/tools/schema.ts） */
export function formatToolCall(data: unknown): string {
    const d = data as ToolCallData | undefined;
    if (!d) return "?";
    const a = d.args ?? {};
    const arg = (k: string): string =>
        typeof a[k] === "string" ? String(a[k]) : "";
    switch (d.name) {
        case "bash":
            return `bash ${arg("command") || ""}`.trim();
        case "read":
        case "write":
            return `${d.name} ${arg("filePath") || ""}`.trim();
        case "edit": {
            const fp = arg("filePath");
            const old = arg("oldString");
            const oldBrief = old ? old.split("\n")[0].slice(0, 40) : "";
            return `edit ${fp}${oldBrief ? `  «${oldBrief}»` : ""}`.trim();
        }
        case "glob":
            return `glob "${arg("pattern")}"${
                arg("path") ? ` @ ${arg("path")}` : ""
            }`.trim();
        case "grep":
            return `grep "${arg("pattern")}"${
                arg("path") ? ` @ ${arg("path")}` : ""
            }`.trim();
        case "explore":
            return `explore ${arg("directoryPath") || ""}`.trim();
        case "plan":
            return `plan ${arg("task") || ""}`.trim();
        default:
            return d.name;
    }
}

export function toolResult(data: unknown): string {
    return (data as ToolCallData | undefined)?.result ?? "";
}
