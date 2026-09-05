import type { AgentEvent, ToolCallData } from "./sseEvents";

// 渲染项：回合块 / sub-agent 分组 / 单事件
export interface TurnItem {
    kind: "turn";
    turnId: string;
    iteration?: AgentEvent;
    assistant?: AgentEvent;
    thinking?: string; // 思考内容累积（Thinking 事件的 message 拼接）
    /** 思考已结束：thinking 之后出现首个非 thinking 事件（文本/工具）即置 true。
     *  驱动 ThinkingBlock 计时器停止——避免"思考后直接调工具无 content"或"长 bash 执行期"
     *  里 assistant/tools 未就位导致计时器空跑。 */
    thinkingFinished?: boolean;
    /** 思考起止时刻（事件 timestamp）：ThinkingBlock 时长由事件推导，与挂载时刻无关——
     *  中途退出再进入显示真实时长（bugfix：原先从挂载时刻重跑 30s 假窗口） */
    thinkingStartedAt?: number;
    thinkingEndedAt?: number;
    tools: Extract<AgentEvent, { type: "Tool" }>[];
    /** 组起点事件下标（增量计算内部用） */
    startIdx?: number;
}
export interface SubagentItem {
    kind: "subagent";
    runId: string;
    author: string;
    events: AgentEvent[];
    startIdx?: number;
}
export interface SingleItem {
    kind: "single";
    event: AgentEvent;
    startIdx?: number;
}
export type RenderItem = TurnItem | SubagentItem | SingleItem;

/**
 * 把一段事件流按回合分组：ITERATION 开新回合，ASSISTANT/TOOL 入当前回合，
 * System/User/Done/Error 单条。sub-agent（带 runId）事件不在此处理——
 * 调用方先按 runId 切出 sub-agent 段，再对主流 / sub-agent 内部各自调本函数。
 *
 * opts.closeThinkingAt：流以终态（Done/Stopped/Error）收尾且最后开着的思考没有
 * 后续实质事件时，以终态时间戳闭合该思考——否则 thinkingFinished 永不置位，
 * ThinkingBlock 会把"已停止/已出错回合"的思考当进行中无限计时（bugfix）。
 */
export function groupByTurn(
    events: AgentEvent[],
    opts?: { closeThinkingAt?: number }
): TurnItem[] {
    const items: TurnItem[] = [];
    let cur: TurnItem | null = null;
    const flush = () => {
        if (cur && (cur.assistant || cur.tools.length || cur.iteration)) {
            items.push(cur);
        }
        cur = null;
    };
    // 思考结束信号：thinking 之后出现任何实质事件（文本增量/定稿/工具）即标记，
    // 供 ThinkingBlock 计时器停止。ToolStart/ToolProgress 也算（思考完→直接调工具）。
    // 结束时刻取该事件的时间戳（AR：时长从事件推导）。
    const markThinkingDone = (t: TurnItem | null, e: AgentEvent) => {
        if (t && t.thinking && !t.thinkingFinished) {
            t.thinkingFinished = true;
            t.thinkingEndedAt = e.timestamp;
        }
    };
    for (const e of events) {
        if (e.type === "Iteration") {
            flush();
            cur = {
                kind: "turn",
                turnId: e.turnId ?? "",
                iteration: e,
                tools: [],
            };
        } else if (e.type === "Thinking") {
            // 思考内容：累积进当前回合的 thinking 字段
            if (!cur) cur = { kind: "turn", turnId: e.turnId ?? "", tools: [] };
            if (cur.thinkingStartedAt === undefined) cur.thinkingStartedAt = e.timestamp;
            cur.thinking = (cur.thinking ?? "") + e.message;
        } else if (e.type === "AssistantDelta") {
            // 流式增量：累积进当前回合的 assistant 文本（实时态，不入盘）。
            // 到 ASSISTANT 定稿时由同回合替换，内容一致。
            if (!cur) cur = { kind: "turn", turnId: e.turnId ?? "", tools: [] };
            markThinkingDone(cur, e);
            if (!cur.assistant) {
                cur.assistant = { ...e, type: "Assistant" } as AgentEvent;
            } else {
                cur.assistant = {
                    ...cur.assistant,
                    message: cur.assistant.message + e.message,
                };
            }
        } else if (e.type === "Assistant") {
            // 定稿：同回合则替换累积的 delta 文本（内容一致），否则正常归位
            markThinkingDone(cur, e);
            if (cur && cur.turnId === (e.turnId ?? "")) {
                cur.assistant = e;
            } else if (cur && !cur.assistant && !cur.tools.length) {
                cur.assistant = e;
            } else {
                flush();
                cur = {
                    kind: "turn",
                    turnId: e.turnId ?? "",
                    assistant: e,
                    tools: [],
                };
            }
        } else if (e.type === "Usage") {
            // 状态元数据，落在 Assistant 与 Tool 之间：不打断当前回合，也不入盘。
            continue;
        } else if (
            e.type === "ToolStart" ||
            e.type === "ToolProgress" ||
            e.type === "ToolArgProgress"
        ) {
            // 流式工具实时事件（不入盘，仅 SSE）：不打断回合分组；
            // 活动工具卡片由 MessageList 从原始 events 直接算（见 activeTool）。
            // ToolArgProgress 也算思考结束（思考完→调工具的 arguments 流式）→ 标记 thinkingFinished。
            markThinkingDone(cur, e);
            continue;
        } else if (e.type === "Tool") {
            if (!cur) cur = { kind: "turn", turnId: e.turnId ?? "", tools: [] };
            markThinkingDone(cur, e);
            cur.tools.push(e);
        } else {
            // 终态（Done/Stopped/Error）闭合开着的思考：以 Thinking 收尾的回合
            // （停止/出错/无正文完成）若不闭合，ThinkingBlock 会无限计时
            if (
                (e.type === "Done" || e.type === "Stopped" || e.type === "Error") &&
                cur &&
                cur.thinking &&
                !cur.thinkingFinished
            ) {
                cur.thinkingFinished = true;
                cur.thinkingEndedAt = e.timestamp;
            }
            flush();
        }
    }
    if (
        opts?.closeThinkingAt !== undefined &&
        cur &&
        cur.thinking &&
        !cur.thinkingFinished
    ) {
        cur.thinkingFinished = true;
        cur.thinkingEndedAt = opts.closeThinkingAt;
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
    let mainStart = 0; // mainBuf 首事件下标（回合 startIdx）
    let sub: { runId: string; author: string; events: AgentEvent[]; startIdx: number } | null =
        null;
    const flushMain = (closeThinkingAt?: number) => {
        for (const t of groupByTurn(mainBuf, { closeThinkingAt })) {
            t.startIdx = mainStart;
            items.push(t);
        }
        mainBuf = [];
    };
    const flushSub = () => {
        if (sub) {
            items.push({
                kind: "subagent",
                runId: sub.runId,
                author: sub.author,
                events: sub.events,
                startIdx: sub.startIdx,
            });
        }
        sub = null;
    };
    for (let i = 0; i < events.length; i++) {
        const e = events[i];
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
                    startIdx: i,
                };
            }
        } else if (
            e.type === "System" ||
            e.type === "User" ||
            e.type === "Done" ||
            e.type === "Stopped" ||
            e.type === "Compact" ||
            e.type === "Error" ||
            e.type === "Warning" ||
            e.type === "Permission"
        ) {
            // single 事件会切分回合：以自身时间戳闭合主流开着的思考
            //（Warning/User/Compact 等切断思考流 → 思考到此为止；终态同样闭合）
            flushMain(e.timestamp);
            flushSub();
            items.push({ kind: "single", event: e, startIdx: i });
        } else {
            flushSub();
            if (!mainBuf.length) mainStart = i;
            mainBuf.push(e);
        }
    }
    flushMain();
    flushSub();
    return items;
}

/** 组起点判定：Iteration / single 切分事件 / sub-agent runId 边界都开新组 */
function isGroupStart(events: AgentEvent[], i: number): boolean {
    const e = events[i];
    if (e.type === "Iteration") return true;
    if (
        e.type === "System" || e.type === "User" || e.type === "Done" ||
        e.type === "Stopped" || e.type === "Compact" || e.type === "Error" ||
        e.type === "Warning" || e.type === "Permission"
    ) return true;
    if (e.runId) {
        const prev = i > 0 ? events[i - 1] : undefined;
        return !prev?.runId || prev.runId !== e.runId;
    }
    return false;
}

/**
 * 增量渲染项（SPEC-036 B-005）：events 由 append 构建（引用稳定），公共前缀内的
 * 已闭合组直接复用上次的对象（配合 TurnBlock/ToolRow 的 React.memo，长会话
 * 追加事件时既有渲染项不重算），只对最后一个开着的组重算。
 * 前缀断裂（resume 重放/压缩重写数组）或空缓存 → 全量重算，行为与 toRenderItems 一致。
 */
export function toRenderItemsIncremental(
    events: AgentEvent[],
    cache?: { events: AgentEvent[]; items: RenderItem[] }
): RenderItem[] {
    if (!cache?.items.length) return toRenderItems(events);
    const min = Math.min(events.length, cache.events.length);
    let m = 0;
    while (m < min && events[m] === cache.events[m]) m++;
    if (m === 0) return toRenderItems(events);
    // 最后一个"安全切分点"：其后的组仍开着（可能吸收后续事件），之前的组全部闭合
    let split = -1;
    for (let i = 0; i < m; i++) if (isGroupStart(events, i)) split = i;
    if (split <= 0) return toRenderItems(events);
    // 闭合组 = 起点严格在切分点之前的组；切分点上的项（含 single）重算——
    // single 重算成本可忽略，避免"既复用又入 tail"的边界重复。
    const closed = cache.items.filter(
        (it) => (it.startIdx ?? Number.MAX_SAFE_INTEGER) < split
    );
    const tail = toRenderItems(events.slice(split));
    for (const it of tail) it.startIdx = (it.startIdx ?? 0) + split;
    return [...closed, ...tail];
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
        // 联网工具（内置连接器）：回显只显"搜了什么 / 抓了哪个 url"，不显内容详情
        case "web_search":
            return `web_search "${arg("query") || ""}"`.trim();
        case "web_fetch":
            return `web_fetch ${arg("url") || ""}`.trim();
        default:
            return d.name;
    }
}

export function toolResult(data: unknown): string {
    return (data as ToolCallData | undefined)?.result ?? "";
}

/** 回显不展结果的工具（联网类）：摘要即全部——搜索词 / 抓取 URL，结果内容交给模型即可。 */
export function toolHidesResult(name: string): boolean {
    return name === "web_search" || name === "web_fetch";
}
