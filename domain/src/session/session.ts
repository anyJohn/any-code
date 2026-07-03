import { randomUUID } from "node:crypto";
import { ChatMessage } from "../type";

/**
 * Session 模块 - 类型 + 纯函数（无 IO，可被任何存储后端复用）
 * 详见 docs/session设计.md
 */

export interface Session {
    id: string;
    title: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
}

export interface SessionKey {
    projectKey: string;
    sessionId: string;
}

/** JSONL 的一行：meta 记录标题/时间，message 记录一条对话消息 */
export type SessionEntry =
    // title 可选：appendMessage 每次追加的 touch meta 只刷 updatedAt 不带 title，
    // 读取时从最近一条带 title 的 meta 沿用标题
    | { kind: "meta"; title?: string; updatedAt: number }
    | { kind: "message"; message: ChatMessage };

/** list() 返回的轻量元数据，不含 messages 数组 */
export interface SessionMeta {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

export const DEFAULT_TITLE = "New Session";

type MetaEntry = Extract<SessionEntry, { kind: "meta" }>;
type MessageEntry = Extract<SessionEntry, { kind: "message" }>;

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

export function messageToEntry(msg: ChatMessage): SessionEntry {
    return { kind: "message", message: msg };
}

function isMeta(e: SessionEntry): e is MetaEntry {
    return e.kind === "meta";
}

function isMessage(e: SessionEntry): e is MessageEntry {
    return e.kind === "message";
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

/** 从落盘条目重建 Session */
export function entriesToSession(id: string, entries: SessionEntry[]): Session {
    const metas = entries.filter(isMeta);
    const messages = entries.filter(isMessage).map((e) => e.message);
    const { title, createdAt, updatedAt } = summarizeMetas(metas);
    return { id, title, messages, createdAt, updatedAt };
}

/** 从条目提取轻量元数据（list 用，只需 meta 行） */
export function metaOf(
    id: string,
    entries: SessionEntry[]
): SessionMeta | null {
    const metas = entries.filter(isMeta);
    if (metas.length === 0) return null;
    const { title, createdAt, updatedAt } = summarizeMetas(metas);
    return { id, title, createdAt, updatedAt };
}
