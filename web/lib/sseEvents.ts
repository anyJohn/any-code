// 前端事件视图：镜像 domain 的 AgentEvent discriminated union（SPEC-030 AC-012，full）。
// 加客户端 id（SSE 无 id，前端 nextId 补）。data/error 均 typed per-variant（无 data?:unknown）。
// spread 注入 id 处用 `as AgentEvent`（discriminated union 的 spread 丢判别，cast 还原）。

interface EventBase {
    id: string;
    timestamp: number;
    message: string;
    turnId?: string;
    author?: string;
    runId?: string;
}

export type AgentEvent =
    | (EventBase & { type: "System" })
    | (EventBase & {
          type: "User";
          /** 命令注入标记（SPEC-040，镜像 domain）：徽标数据源，旧事件无此字段走嗅探兜底 */
          command?: { name: string; args?: string; body?: string };
          /** 来源（SPEC-040）：human=用户输入（缺省）；system=系统注入 */
          origin?: "human" | "system";
      })
    | (EventBase & { type: "Iteration" })
    | (EventBase & { type: "Thinking" })
    | (EventBase & { type: "Assistant" })
    | (EventBase & { type: "AssistantDelta" })
    | (EventBase & { type: "Tool"; data: ToolCallData })
    | (EventBase & { type: "ToolStart"; data: ToolStartData })
    | (EventBase & { type: "ToolProgress" })
    | (EventBase & { type: "ToolArgProgress"; data: ToolArgProgressData })
    | (EventBase & { type: "Usage"; data: UsageData })
    | (EventBase & { type: "Compact"; data: CompactData })
    | (EventBase & { type: "Interaction"; data: InteractionData })
    | (EventBase & { type: "Planning"; data: PlanningEventData })
    | (EventBase & { type: "Permission"; data: PermissionEventData })
    | (EventBase & { type: "PermissionAsk"; data: PermissionAskData })
    | (EventBase & { type: "Error"; error: ErrorPayload })
    | (EventBase & { type: "Warning"; error?: ErrorPayload })
    | (EventBase & { type: "Done" })
    | (EventBase & { type: "Stopped" });

/** SSE/payload：AgentEvent 去掉 id（distributive Omit，保 variant data/error）。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends T
    ? Omit<T, K>
    : never;
export type AgentEventPayload = DistributiveOmit<AgentEvent, "id">;
export type EventType = AgentEvent["type"];

/**
 * 命令首行解析（SPEC-040）：web 内单份拷贝（镜像层协议，不跨包依赖 domain——
 * web 对 domain 零运行时依赖的纪律不变；domain 侧 commands.ts 持有自己的同义实现）。
 * 用于旧 session 无 command 字段时的徽标嗅探兜底（MessageList）。
 */
export const SLASH_COMMAND_RE = /^\/([\w-]+)(?:\s+([\s\S]+))?$/;

// ── per-variant data 形状（镜像 domain type.ts）──

export interface UsageData {
    prompt_tokens: number;
    completion_tokens: number;
    contextWindow: number;
    /** FR-22：产生该用量的模型 id（费用按模型单价换算；老事件缺省） */
    model?: string;
}
export interface ToolCallData {
    name: string;
    args: Record<string, unknown>;
    result: string;
    /** 结构化元数据（FR-10）：exitCode/spillFile/filePath 等，UI/系统消费 */
    meta?: Record<string, unknown>;
}
export interface ToolStartData {
    name: string;
    args: unknown;
}
export interface ToolArgProgressData {
    bytes: number;
    name?: string;
}
export interface CompactData {
    beforeTokens: number;
    afterTokens: number;
    auto: boolean;
    focus?: string | null;
}
/** plan 模式计划（FR-12，durable）。镜像 domain PlanningEventData。 */
export interface PlanningEventData {
    plan: string;
    round: number;
}
export interface InteractionQuestion {
    question: string;
    header?: string;
    options?: string[];
    multiSelect?: boolean;
}
export interface InteractionData {
    id: string;
    questions: InteractionQuestion[];
}
/** 权限审计（durable，回放可见）。镜像 domain PermissionEventData。 */
export interface PermissionEventData {
    tool: string;
    pattern?: string;
    source: "rule" | "baseline" | "mode";
    action: "allow" | "ask" | "deny";
    phase: "asked" | "decided";
    decision?: "allow_once" | "allow_always" | "deny" | "timeout";
    scope?: "project" | "global";
    summary?: string;
}
/** 权限裁决请求（live-only，驱动 PermissionModal）。镜像 domain PermissionAskData。 */
export interface PermissionAskData {
    id: string;
    tool: string;
    pattern?: string;
    summary?: string;
    danger?: boolean;
}
export interface ErrorPayload {
    message: string;
    name: string;
    stack?: string;
    cause?: string;
}

// history 端点返回的 ChatMessage 的最小视图
export interface HistoryMessage {
    role: string;
    content: unknown;
    tool_calls?: Array<{
        id: string;
        function: { name: string; arguments?: string };
    }>;
    tool_call_id?: string;
    _meta?: { reasoning?: string };
}

let idCounter = 0;
export const nextId = (prefix: string) => `${prefix}-${idCounter++}`;

// ── FR-30 / SPEC-033：流帧与运行状态 ──

/** SSE 帧：server AgentManager 打 per-run 单调序号；seq=-1 为合成帧（排队提示/错误）。 */
export interface StreamFrame {
    seq: number;
    event: AgentEventPayload;
}

/** 会话运行状态（会话列表徽标 / 全局 ask 提醒）。 */
export type SessionRunStatus = "queued" | "running" | "waiting_ask";

/** FR-22：会话累计用量（镜像 domain SessionUsage）。 */
export interface SessionUsageInfo {
    promptTokens: number;
    completionTokens: number;
    byModel?: Record<string, { promptTokens: number; completionTokens: number }>;
}

/** 会话列表项：SessionMeta + server 合并的运行状态（idle 时无 status 字段）。 */
export interface SessionListItem {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    status?: SessionRunStatus;
    pendingAsk?: { id: string; tool: string; summary: string } | null;
    /** FR-22：会话累计用量（无 Usage 记录则缺省） */
    usage?: SessionUsageInfo;
}

/** 工作区（含内联 sessions——GET /api/workspaces 一次返回全部，避免点开二次请求）。 */
export interface WorkspaceWithSessions {
    rootPath: string;
    projectKey: string;
    name: string;
    addedAt: number;
    lastUsedAt: number;
    sessions?: SessionListItem[];
}

/** GET /api/running 条目：全局运行快照（跨工作区，含会话标题）。 */
export interface RunningSessionInfo {
    sessionId: string;
    projectKey: string;
    status: SessionRunStatus;
    pendingAsk: { id: string; tool: string; summary: string } | null;
    startedAt: number;
    title: string;
}
