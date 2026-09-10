/** misc 路由（自 index.ts 机械拆分，零逻辑改动）。 */
import {
    SessionService,
    WorkspaceRegistry,
} from "@any-code/domain";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import os from "node:os";

import type { Hono } from "hono";

export function registerMiscRoutes(app: Hono): void {
    // ==================== misc ====================
    app.get("/api/fs/browse", (c) => {
        const requested = c.req.query("dir") || "";
        const isWin = process.platform === "win32";
        const DRIVES_SENTINEL = "::drives::";

        if (isWin && requested === DRIVES_SENTINEL) {
            const out: { name: string; path: string }[] = [];
            for (let ch = 67; ch <= 90; ch++) {
                const letter = String.fromCharCode(ch);
                const root = `${letter}:\\`;
                try {
                    statSync(root);
                    out.push({ name: `${letter}:`, path: root });
                } catch {
                    // 盘不存在
                }
            }
            return c.json({ current: "此电脑", parent: null, dirs: out });
        }

        const start = requested || os.homedir();
        let resolved = resolve(start);
        try {
            const st = statSync(resolved);
            if (!st.isDirectory()) resolved = dirname(resolved);
        } catch {
            resolved = os.homedir();
        }
        let dirs: { name: string; path: string }[] = [];
        try {
            const entries = readdirSync(resolved, { withFileTypes: true });
            dirs = entries
                .filter((e) => e.isDirectory() && !e.name.startsWith("."))
                .map((e) => ({ name: e.name, path: join(resolved, e.name) }))
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch {
            // 无读权限等
        }
        const root = parsePath(resolved).root;
        const parent =
            resolved === root
                ? isWin
                    ? DRIVES_SENTINEL
                    : null
                : dirname(resolved);
        return c.json({ current: resolved, parent, dirs });
    });

    app.get("/api/search", async (c) => {
        const q = (c.req.query("q") ?? "").trim().toLowerCase();
        if (!q) return c.json({ sessions: [], workspaces: [] });
        const svc = new SessionService();
        const workspaces = WorkspaceRegistry.list();
        const workspacesHits = workspaces
            .filter(
                (w) =>
                    w.name.toLowerCase().includes(q) ||
                    w.rootPath.toLowerCase().includes(q),
            )
            .map((w) => ({ projectKey: w.projectKey, name: w.name, rootPath: w.rootPath }));
        const sessionHits: {
            projectKey: string;
            sessionId: string;
            title: string;
            updatedAt: number;
            workspaceName: string;
            rootPath: string;
        }[] = [];
        const MAX = 50;
        for (const w of workspaces) {
            if (sessionHits.length >= MAX) break;
            try {
                const list = await svc.list(w.projectKey);
                for (const s of list) {
                    if (sessionHits.length >= MAX) break;
                    if ((s.title || "").toLowerCase().includes(q)) {
                        sessionHits.push({
                            projectKey: w.projectKey,
                            sessionId: s.id,
                            title: s.title || "（无标题）",
                            updatedAt: s.updatedAt,
                            workspaceName: w.name,
                            rootPath: w.rootPath,
                        });
                    }
                }
            } catch {
                // 某工作区读盘失败不阻断其他
            }
        }
        sessionHits.sort((a, b) => b.updatedAt - a.updatedAt);
        return c.json({ sessions: sessionHits, workspaces: workspacesHits });
    });
}
