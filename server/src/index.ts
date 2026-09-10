import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { workspaceJobs } from "./shared.js";
import { getAgentManager } from "./agentManager.js";
import { registerWorkspacesRoutes, registerSessionsRoutes, registerConfigRoutes, registerJobsRoutes, registerSnapshotsRoutes, registerPermissionsRoutes, registerMiscRoutes } from "./routes/index.js";

/**
 * AnyCode HTTP server (hono) —— 静态 SPA 的薄 driving adapter。
 * 只依赖 @any-code/domain，无业务逻辑；29 个 API 路由 + 1 个静态 SPA catch-all
 * （Web Request/Response 同构，SSE 用 ReadableStream 原样）。见 DEC-007 / SPEC-028 / SPEC-033。
 */
// events 已可序列化 by construction（domain serializeError 把 Error 转 plain ErrorPayload），
// SSE 与持久化均直接 JSON.stringify，无需 replacer（SPEC-030 B-002/B-010/I-001）。
// TERMINAL / DURABLE_TYPES 持久化与终态判定职责在 agentManager.ts。


const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".map": "application/json",
};

/** 安全读静态文件 + SPA fallback（非 /api 的 GET 落回 index.html）。 */
function staticOrSpa(c: Context, staticDir: string): Response {
    const url = new URL(c.req.url);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("/api/")) return c.text("not found", 404);
    const rel = pathname === "/" ? "/index.html" : pathname;
    // 防路径穿越：解析后必须仍在 staticDir 下
    const fp = resolve(staticDir, "." + rel);
    if (!fp.startsWith(resolve(staticDir))) return c.text("forbidden", 403);
    try {
        const st = statSync(fp);
        if (st.isFile()) {
            const ext = fp.slice(fp.lastIndexOf("."));
            return c.body(readFileSync(fp), 200, {
                "Content-Type": MIME[ext] ?? "application/octet-stream",
            }) as Response;
        }
    } catch {
        // 文件不存在 → 走 SPA fallback
    }
    const idx = join(staticDir, "index.html");
    if (existsSync(idx)) {
        return c.body(readFileSync(idx, "utf8"), 200, {
            "Content-Type": "text/html; charset=utf-8",
        }) as Response;
    }
    return c.text("not found", 404);
}

export function createApp(opts: { staticDir?: string } = {}): Hono {
    const app = new Hono();
    registerWorkspacesRoutes(app);
    registerSessionsRoutes(app);
    registerConfigRoutes(app);
    registerJobsRoutes(app);
    registerSnapshotsRoutes(app);
    registerPermissionsRoutes(app);
    registerMiscRoutes(app);

    // ==================== 静态 SPA（prod） ====================
    if (opts.staticDir) {
        const dir = opts.staticDir;
        app.get("/*", (c) => staticOrSpa(c, dir));
    }

    return app;
}

export interface StartResult {
    port: number;
    hostname: string;
    close: () => void;
}

/** 起 server。port/hostname/staticDir 可注入；port 缺省读 env（PORT/ANYCODE_WEB_DIST）。 */
export async function start(opts: {
    port?: number;
    hostname?: string;
    staticDir?: string;
} = {}): Promise<StartResult> {
    const app = createApp({ staticDir: opts.staticDir ?? process.env.ANYCODE_WEB_DIST });
    const port = Number(opts.port ?? process.env.PORT ?? 3000) || 3000;
    // 恒绑回环地址，不读 HOSTNAME env：Windows 下它是计算机名、Linux shell 也常设为机器名，
    // 当主机名解析会绑到非回环地址，破坏"仅本机监听"立场（desktop 需要时经 opts 显式注入）。
    const hostname = opts.hostname ?? "127.0.0.1";
    const server = serve({ fetch: app.fetch, port, hostname });
    // FR-30 B-007：进程退出统一清理运行中 agent（不留孤儿 LLM 流 / bash / MCP 子进程）
    const shutdown = (signal: string) => {
        getAgentManager().stopAll();
        for (const r of workspaceJobs.values()) r.killAll();
        try {
            server.close();
        } catch {
            // 已关
        }
        process.exit(0);
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    return { port, hostname, close: () => server.close() };
}

