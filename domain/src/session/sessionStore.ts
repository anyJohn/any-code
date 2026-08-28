import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ChatMessage } from "../type";
import {
    SessionEntry,
    SessionKey,
    SessionMeta,
    messageToEntry,
    metaOf,
} from "./session";

/**
 * SessionStore - 存储适配器接口
 * 本地文件实现 LocalSessionStore 藏着 os.homedir()，前端层不接触。
 * web 服务端将来实现 DbSessionStore 时业务层零改动。
 */
export interface SessionStore {
    append(key: SessionKey, entries: SessionEntry[]): Promise<void>;
    /** 原子重写整个 session：保留原 title/createdAt，用给定 messages 替换全部消息。 */
    replaceMessages(key: SessionKey, messages: ChatMessage[]): Promise<void>;
    load(key: SessionKey): Promise<SessionEntry[] | null>;
    listMeta(projectKey: string): Promise<SessionMeta[]>;
    listAllMeta(): Promise<SessionMeta[]>;
    remove(key: SessionKey): Promise<void>;
    /** 跨项目按 sessionId 反查所属 projectKey（sessionId-URL 直链解析用） */
    findKey(sessionId: string): Promise<SessionKey | null>;
}

/** 项目级 session 落盘根目录。惰性读 os.homedir()——posix 每次 call 读 HOME env，便于测试注入。 */
function baseDir(): string {
    return path.join(os.homedir(), ".anycode", "projects");
}

function fileOf(key: SessionKey): string {
    return path.join(baseDir(), key.projectKey, `${key.sessionId}.jsonl`);
}

function dirOf(projectKey: string): string {
    return path.join(baseDir(), projectKey);
}

/** 读文件全部 meta 行（setTitle 在末尾追加新 meta，需取末条才一致） */
async function readMetas(file: string): Promise<SessionEntry[]> {
    // 返回所有 meta 条目；跳过对大 message 行的解析以控制开销
    const metas: SessionEntry[] = [];
    try {
        const content = await fs.readFile(file, "utf-8");
        for (const line of content.split("\n")) {
            if (!line || !line.includes('"kind":"meta"')) continue;
            try {
                const entry = JSON.parse(line) as SessionEntry;
                if (entry.kind === "meta") metas.push(entry);
            } catch {
                // 跳过损坏行
            }
        }
    } catch {
        // 文件不存在等
    }
    return metas;
}

export class LocalSessionStore implements SessionStore {
    async append(key: SessionKey, entries: SessionEntry[]): Promise<void> {
        if (entries.length === 0) return;
        const file = fileOf(key);
        await fs.mkdir(path.dirname(file), { recursive: true });
        const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
        await fs.appendFile(file, lines, "utf-8");
    }

    async replaceMessages(
        key: SessionKey,
        messages: ChatMessage[]
    ): Promise<void> {
        const file = fileOf(key);
        await fs.mkdir(path.dirname(file), { recursive: true });
        // 保留原 title/createdAt：读现有 meta 提炼，缺失则用默认。
        const metas = await readMetas(file);
        const id = key.sessionId;
        const orig = metas.length ? metaOf(id, metas) : null;
        const now = Date.now();
        const createdAt = orig?.createdAt ?? now;
        const title = orig?.title;
        const entries: SessionEntry[] = [
            // 两条 meta：首条保 createdAt（entriesToSession 取首条 meta.updatedAt 为 createdAt），
            // 末条保 title + 刷 updatedAt（取末条 meta.updatedAt）。位置上集中前置即可。
            { kind: "meta", updatedAt: createdAt },
            { kind: "meta", title, updatedAt: now },
        ];
        for (const m of messages) {
            // system 不入盘（与 appendMessage 一致：system 每任务重建，不持久化）
            if ((m as unknown as Record<string, unknown>).role === "system") continue;
            entries.push(messageToEntry(m));
        }
        const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
        // 原子写：临时文件 + rename，防中途崩溃留下半截 JSONL
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, lines, "utf-8");
        await fs.rename(tmp, file);
    }

    async load(key: SessionKey): Promise<SessionEntry[] | null> {
        try {
            const content = await fs.readFile(fileOf(key), "utf-8");
            const entries: SessionEntry[] = [];
            for (const line of content.split("\n")) {
                if (!line) continue;
                try {
                    entries.push(JSON.parse(line) as SessionEntry);
                } catch {
                    // 跳过单行损坏，不丢弃整条 session
                }
            }
            return entries;
        } catch {
            return null;
        }
    }

    async listMeta(projectKey: string): Promise<SessionMeta[]> {
        const dir = dirOf(projectKey);
        let files: string[];
        try {
            files = await fs.readdir(dir);
        } catch {
            return [];
        }
        const metas: SessionMeta[] = [];
        for (const f of files) {
            if (!f.endsWith(".jsonl")) continue;
            const id = f.slice(0, -".jsonl".length);
            const metaEntries = await readMetas(path.join(dir, f));
            const meta = metaOf(id, metaEntries);
            if (meta) metas.push(meta);
        }
        metas.sort((a, b) => b.updatedAt - a.updatedAt);
        return metas;
    }

    async listAllMeta(): Promise<SessionMeta[]> {
        try {
            const base = baseDir();
            const projectDirs = await fs.readdir(base);
            const all: SessionMeta[] = [];
            for (const pk of projectDirs) {
                const stat = await fs.stat(path.join(base, pk));
                if (stat.isDirectory()) {
                    all.push(...(await this.listMeta(pk)));
                }
            }
            all.sort((a, b) => b.updatedAt - a.updatedAt);
            return all;
        } catch {
            return [];
        }
    }

    async remove(key: SessionKey): Promise<void> {
        try {
            await fs.unlink(fileOf(key));
        } catch {
            // 忽略文件不存在
        }
    }

    async findKey(sessionId: string): Promise<SessionKey | null> {
        try {
            const base = baseDir();
            for (const pk of await fs.readdir(base)) {
                try {
                    await fs.stat(path.join(base, pk, `${sessionId}.jsonl`));
                    return { projectKey: pk, sessionId };
                } catch {
                    // 不在该 project 目录，继续
                }
            }
        } catch {
            // baseDir 不存在
        }
        return null;
    }
}
