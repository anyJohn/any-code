import { NextResponse } from "next/server";
import { WorkspaceRegistry, SessionService } from "@any-code/domain";

export interface SearchSessionHit {
    projectKey: string;
    sessionId: string;
    title: string;
    updatedAt: number;
    workspaceName: string;
    rootPath: string;
}
export interface SearchWorkspaceHit {
    projectKey: string;
    name: string;
    rootPath: string;
}
export interface SearchResponse {
    sessions: SearchSessionHit[];
    workspaces: SearchWorkspaceHit[];
}

const MAX_SESSION_HITS = 50;

// GET /api/search?q=foo —— 跨所有已注册工作区搜 session title + 工作区 name/path。
// 服务端扫（客户端只覆盖已展开工作区的已加载 session，太弱）；大小写不敏感子串匹配。
export async function GET(req: Request) {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!q) {
        return NextResponse.json({ sessions: [], workspaces: [] } satisfies SearchResponse);
    }
    const svc = new SessionService();
    const workspaces = WorkspaceRegistry.list();
    const workspacesHits: SearchWorkspaceHit[] = workspaces.filter((w) =>
        w.name.toLowerCase().includes(q) || w.rootPath.toLowerCase().includes(q)
    ).map((w) => ({ projectKey: w.projectKey, name: w.name, rootPath: w.rootPath }));

    const sessionHits: SearchSessionHit[] = [];
    for (const w of workspaces) {
        if (sessionHits.length >= MAX_SESSION_HITS) break;
        try {
            const list = await svc.list(w.projectKey);
            for (const s of list) {
                if (sessionHits.length >= MAX_SESSION_HITS) break;
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
            // 某工作区 sessions 读盘失败不阻断其他工作区
        }
    }
    // session 按更新时间倒序
    sessionHits.sort((a, b) => b.updatedAt - a.updatedAt);
    return NextResponse.json({
        sessions: sessionHits,
        workspaces: workspacesHits,
    } satisfies SearchResponse);
}
