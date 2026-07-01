import { ChatMessage } from "../type";
import {
    Session,
    SessionKey,
    SessionMeta,
    createSession,
    entriesToSession,
    metaEntry,
    messageToEntry,
    titleMetaEntry,
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

    /** 跨项目列表（web 侧栏用） */
    async listAll(): Promise<SessionMeta[]> {
        return this.store.listAllMeta();
    }

    async remove(projectKey: string, sessionId: string): Promise<void> {
        return this.store.remove({ projectKey, sessionId });
    }

    /** 追加一条消息；system message 不入盘 */
    async appendMessage(key: SessionKey, msg: ChatMessage): Promise<void> {
        if (msg.role === "system") return;
        await this.store.append(key, [messageToEntry(msg)]);
    }

    /** 更新标题：追加一条新 meta（entriesToSession 取末条 meta 为准） */
    async setTitle(key: SessionKey, title: string): Promise<void> {
        await this.store.append(key, [titleMetaEntry(title)]);
    }
}
