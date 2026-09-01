import { ChatMessage, AgentEvent } from "../type";
import {
    Session,
    SessionKey,
    SessionMeta,
    createSession,
    entriesToSession,
    eventToEntry,
    metaEntry,
    messageToEntry,
    titleMetaEntry,
    touchMetaEntry,
} from "./session";
import { LocalSessionStore, SessionStore } from "./sessionStore";

/**
 * SessionService - 稳定 API 表面
 * 前端层（TUI / 未来 web）的唯一入口。纯协调层，不含文件/路径知识。
 * 构造时注入 SessionStore：本地用 LocalSessionStore，web 服务端将来注入 DbSessionStore。
 */
export class SessionService {
    constructor(private store: SessionStore = new LocalSessionStore()) {}

    /** 新建会话并落盘首条 meta */
    async create(projectKey: string, title?: string): Promise<Session> {
        const session = createSession(title);
        const key: SessionKey = { projectKey, sessionId: session.id };
        await this.store.append(key, [metaEntry(session)]);
        return session;
    }

    /** 恢复指定会话；不存在返回 null */
    async resume(
        projectKey: string,
        sessionId: string
    ): Promise<Session | null> {
        const key: SessionKey = { projectKey, sessionId };
        const entries = await this.store.load(key);
        if (!entries) return null;
        return entriesToSession(sessionId, entries);
    }

    /** 恢复最近一条会话；无历史返回 null */
    async continueRecent(projectKey: string): Promise<Session | null> {
        const metas = await this.list(projectKey);
        if (metas.length === 0) return null;
        return this.resume(projectKey, metas[0].id);
    }

    async list(projectKey: string): Promise<SessionMeta[]> {
        return this.store.listMeta(projectKey);
    }

    async remove(projectKey: string, sessionId: string): Promise<void> {
        return this.store.remove({ projectKey, sessionId });
    }

    /** 追加一条消息；system message 不入盘。同时写 touch meta 刷新 updatedAt，保证 list/continueRecent 按最后活动时间排序 */
    async appendMessage(key: SessionKey, msg: ChatMessage): Promise<void> {
        if (msg.role === "system") return;
        await this.store.append(key, [messageToEntry(msg), touchMetaEntry()]);
    }

    /** 追加一条非消息事件（如 Error）到 session JSONL（与 touch meta 一次写，原子）。
     *  data 应已是可序列化结构（Error 由 adapter 边界提取，不在 domain 内处理）。 */
    async appendEvent(key: SessionKey, event: AgentEvent): Promise<void> {
        await this.store.append(key, [eventToEntry(event), touchMetaEntry()]);
    }

    /** 更新标题：追加一条新 meta（entriesToSession 取末条 meta 为准） */
    async setTitle(key: SessionKey, title: string): Promise<void> {
        await this.store.append(key, [titleMetaEntry(title)]);
    }

    /** 原子重写整个 session 的消息（压缩后整体替换）。保留原 title/createdAt。 */
    async replaceMessages(key: SessionKey, messages: ChatMessage[]): Promise<void> {
        await this.store.replaceMessages(key, messages);
    }

    /** 跨项目按 sessionId 反查 session（直链 /chat/:sessionId 解析用，返回所属 key + session） */
    async findSession(
        sessionId: string
    ): Promise<{ key: SessionKey; session: Session } | null> {
        const key = await this.store.findKey(sessionId);
        if (!key) return null;
        const entries = await this.store.load(key);
        if (!entries) return null;
        return { key, session: entriesToSession(sessionId, entries) };
    }
}
