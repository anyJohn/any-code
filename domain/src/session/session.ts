import { randomUUID } from "node:crypto";
import { ChatMessage, AgentEvent } from "../type";

/**
 * Session 模块 - 类型 + 纯函数（无 IO，可被任何存储后端复用）
 * 详见 docs/session设计.md
 */

export interface Session {
    id: string;
    title: string;
    messages: ChatMessage[];
    events: AgentEvent[];
    createdAt: number;
    updatedAt: number;
    /** FR-22：会话累计用量（meta 折叠；无 Usage 事件则缺省） */
    usage?: SessionUsage;
    /** AR-23：最近一次请求的 system prompt 指纹 */
    sysfp?: SystemFingerprint;
}

export interface SessionKey {
    projectKey: string;
    sessionId: string;
}

/** JSONL 的一行：meta 记录标题/时间/用量增量/系统提示指纹，message 记录一条对话消息，event 记录非消息事件（如 Error） */
export type SessionEntry =
    | {
          kind: "meta";
          title?: string;
          updatedAt: number;
          /** FR-22：用量增量（Usage 事件落盘时同批写入，fold 求和得会话累计） */
          usage?: UsageDelta;
          /** AR-23：system prompt 指纹（动态装配内容不入盘，留哈希作审计锚点；末条为准） */
          sysfp?: SystemFingerprint;
      }
    | { kind: "message"; message: ChatMessage }
    | { kind: "event"; event: AgentEvent };

/** FR-22：一次 LLM 调用的用量增量（model = 产生该用量的模型 id） */
export interface UsageDelta {
    promptTokens: number;
    completionTokens: number;
    model?: string;
}

/** AR-23：system prompt 指纹（sha256 前 16 hex；hash 相同 = 装配结果一致） */
export interface SystemFingerprint {
    hash: string;
    /** 产生该请求的模型 id（同模型同指纹才可严格比对） */
    model?: string;
}

/** FR-22：会话累计用量（byModel 供费用按模型单价换算） */
export interface SessionUsage {
    promptTokens: number;
    completionTokens: number;
    byModel?: Record<string, { promptTokens: number; completionTokens: number }>;
}

/** list() 返回的轻量元数据，不含 messages 数组 */
export interface SessionMeta {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    /** FR-22：会话累计用量（无 Usage 事件则缺省） */
    usage?: SessionUsage;
    /** AR-23：最近一次请求的 system prompt 指纹（无记录则缺省） */
    sysfp?: SystemFingerprint;
}

export const DEFAULT_TITLE = "New Session";

type MetaEntry = Extract<SessionEntry, { kind: "meta" }>;
type MessageEntry = Extract<SessionEntry, { kind: "message" }>;
type EventEntry = Extract<SessionEntry, { kind: "event" }>;

export function eventToEntry(event: AgentEvent): SessionEntry {
    return { kind: "event", event };
}

/** 将工作目录编码为 projectKey（保留 unicode 便于调试） */
export function projectKeyOf(cwd: string): string {
    return cwd.replace(/[/\\:]/g, "-");
}

export function createSession(title: string = DEFAULT_TITLE): Session {
    const now = Date.now();
    return {
        id: randomUUID(),
        title,
        messages: [],
        events: [],
        createdAt: now,
        updatedAt: now,
    };
}

export function metaEntry(session: Session): SessionEntry {
    return { kind: "meta", title: session.title, updatedAt: session.updatedAt };
}

export function titleMetaEntry(title: string): SessionEntry {
    return { kind: "meta", title, updatedAt: Date.now() };
}

/** touch meta：仅刷新 updatedAt，不携带 title（沿用最近一条带 title 的 meta） */
export function touchMetaEntry(): SessionEntry {
    return { kind: "meta", updatedAt: Date.now() };
}

/** FR-22：用量增量 meta（与 Usage 事件同批落盘；updatedAt 顺带刷新） */
export function usageMetaEntry(delta: UsageDelta): SessionEntry {
    return { kind: "meta", updatedAt: Date.now(), usage: delta };
}

/** AR-23：system prompt 指纹 meta（每 run 装配结果变化时写一条；updatedAt 顺带刷新） */
export function sysFpMetaEntry(fp: SystemFingerprint): SessionEntry {
    return { kind: "meta", updatedAt: Date.now(), sysfp: fp };
}

export function messageToEntry(msg: ChatMessage): SessionEntry {
    return { kind: "message", message: msg };
}

function isMeta(e: SessionEntry): e is MetaEntry {
    return e.kind === "meta";
}

function isMessage(e: SessionEntry): e is MessageEntry {
    return e.kind === "message";
}

function isEvent(e: SessionEntry): e is EventEntry {
    return e.kind === "event";
}

/** FR-22：折叠 meta 里的用量增量为会话累计（byModel 按模型归并）。无用量记录返回 undefined。 */
function foldUsage(metas: MetaEntry[]): SessionUsage | undefined {
    let promptTokens = 0;
    let completionTokens = 0;
    let any = false;
    let byModel: Record<string, { promptTokens: number; completionTokens: number }> | undefined;
    for (const m of metas) {
        if (!m.usage) continue;
        any = true;
        promptTokens += m.usage.promptTokens;
        completionTokens += m.usage.completionTokens;
        if (m.usage.model) {
            byModel ??= {};
            const slot = (byModel[m.usage.model] ??= { promptTokens: 0, completionTokens: 0 });
            slot.promptTokens += m.usage.promptTokens;
            slot.completionTokens += m.usage.completionTokens;
        }
    }
    if (!any) return undefined;
    return byModel ? { promptTokens, completionTokens, byModel } : { promptTokens, completionTokens };
}

/**
 * 从 meta 条目提炼 title/createdAt/updatedAt。
 * - createdAt：首条 meta 的 updatedAt（create 时写入）
 * - updatedAt：末条 meta 的 updatedAt（touch meta 持续刷新）
 * - title：从末尾往前找最近一条带 title 的 meta；都没有则用默认标题
 */
function summarizeMetas(metas: MetaEntry[]): {
    title: string;
    createdAt: number;
    updatedAt: number;
} {
    if (metas.length === 0) {
        const now = Date.now();
        return { title: DEFAULT_TITLE, createdAt: now, updatedAt: now };
    }
    const createdAt = metas[0].updatedAt;
    const updatedAt = metas[metas.length - 1].updatedAt;
    let title: string | undefined;
    for (let i = metas.length - 1; i >= 0; i--) {
        if (metas[i].title != null) {
            title = metas[i].title;
            break;
        }
    }
    return { title: title ?? DEFAULT_TITLE, createdAt, updatedAt };
}

/** AR-23：取最近一次 system prompt 指纹（末条为准）。无记录返回 undefined。 */
function lastSysFp(metas: MetaEntry[]): SystemFingerprint | undefined {
    for (let i = metas.length - 1; i >= 0; i--) {
        if (metas[i].sysfp) return metas[i].sysfp;
    }
    return undefined;
}

/** 从落盘条目重建 Session */
export function entriesToSession(id: string, entries: SessionEntry[]): Session {
    const metas = entries.filter(isMeta);
    const messages = entries.filter(isMessage).map((e) => e.message);
    const events = entries.filter(isEvent).map((e) => e.event);
    const { title, createdAt, updatedAt } = summarizeMetas(metas);
    return {
        id,
        title,
        messages,
        events,
        createdAt,
        updatedAt,
        usage: foldUsage(metas), // FR-22
        sysfp: lastSysFp(metas), // AR-23
    };
}

/** 从条目提取轻量元数据（list 用，只需 meta 行） */
export function metaOf(
    id: string,
    entries: SessionEntry[]
): SessionMeta | null {
    const metas = entries.filter(isMeta);
    if (metas.length === 0) return null;
    const { title, createdAt, updatedAt } = summarizeMetas(metas);
    return {
        id,
        title,
        createdAt,
        updatedAt,
        usage: foldUsage(metas), // FR-22
        sysfp: lastSysFp(metas), // AR-23
    };
}
