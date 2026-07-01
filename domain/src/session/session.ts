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
    | { kind: "meta"; title: string; updatedAt: number }
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

export function messageToEntry(msg: ChatMessage): SessionEntry {
    return { kind: "message", message: msg };
}

function isMeta(e: SessionEntry): e is MetaEntry {
    return e.kind === "meta";
}

function isMessage(e: SessionEntry): e is MessageEntry {
    return e.kind === "message";
}

/** 从落盘条目重建 Session：createdAt 取首条 meta，updatedAt/title 取末条 meta */
export function entriesToSession(id: string, entries: SessionEntry[]): Session {
    const metas = entries.filter(isMeta);
    const messages = entries.filter(isMessage).map((e) => e.message);
    const createdAt = metas.length > 0 ? metas[0].updatedAt : Date.now();
    const updatedAt =
        metas.length > 0 ? metas[metas.length - 1].updatedAt : createdAt;
    const title =
        metas.length > 0 ? metas[metas.length - 1].title : DEFAULT_TITLE;
    return { id, title, messages, createdAt, updatedAt };
}

/** 从条目提取轻量元数据（list 用，只需 meta 行） */
export function metaOf(
    id: string,
    entries: SessionEntry[]
): SessionMeta | null {
    const metas = entries.filter(isMeta);
    if (metas.length === 0) return null;
    return {
        id,
        title: metas[metas.length - 1].title,
        createdAt: metas[0].updatedAt,
        updatedAt: metas[metas.length - 1].updatedAt,
    };
}
