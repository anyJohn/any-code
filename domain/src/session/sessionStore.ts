import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { SessionEntry, SessionKey, SessionMeta, metaOf } from "./session";

/**
 * SessionStore - 存储适配器接口
 * 本地文件实现 LocalSessionStore 藏着 os.homedir()，前端层不接触。
 * web 服务端将来实现 DbSessionStore 时业务层零改动。
 */
export interface SessionStore {
    append(key: SessionKey, entries: SessionEntry[]): Promise<void>;
    load(key: SessionKey): Promise<SessionEntry[] | null>;
    listMeta(projectKey: string): Promise<SessionMeta[]>;
    listAllMeta(): Promise<SessionMeta[]>;
    remove(key: SessionKey): Promise<void>;
    /** 跨项目按 sessionId 反查所属 projectKey（sessionId-URL 直链解析用） */
    findKey(sessionId: string): Promise<SessionKey | null>;
}

const BASE_DIR = path.join(os.homedir(), ".anycode", "projects");

function fileOf(key: SessionKey): string {
    return path.join(BASE_DIR, key.projectKey, `${key.sessionId}.jsonl`);
}

function dirOf(projectKey: string): string {
    return path.join(BASE_DIR, projectKey);
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
            const projectDirs = await fs.readdir(BASE_DIR);
            const all: SessionMeta[] = [];
            for (const pk of projectDirs) {
                const stat = await fs.stat(path.join(BASE_DIR, pk));
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
            for (const pk of await fs.readdir(BASE_DIR)) {
                try {
                    await fs.stat(path.join(BASE_DIR, pk, `${sessionId}.jsonl`));
                    return { projectKey: pk, sessionId };
                } catch {
                    // 不在该 project 目录，继续
                }
            }
        } catch {
            // BASE_DIR 不存在
        }
        return null;
    }
}
