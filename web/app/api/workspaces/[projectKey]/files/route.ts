import { NextResponse } from "next/server";
import {
    WorkspaceRegistry,
    createWorkspace,
    type Workspace,
} from "@any-code/domain";
import { getFileIndex, type FileEntry } from "@/lib/fileIndex";

function resolveWorkspace(projectKey: string): Workspace | null {
    const meta = WorkspaceRegistry.list().find((w) => w.projectKey === projectKey);
    return meta ? createWorkspace(meta.rootPath) : null;
}

// GET /api/workspaces/:projectKey/files?q=<prefix> —— 从预热的文件索引中 substring 过滤，
// 上限 20 条。索引在 /chat 加载时（status route）预热，命中缓存无 collect 延迟。SPEC-020 B-005。
export async function GET(
    req: Request,
    ctx: { params: Promise<{ projectKey: string }> }
) {
    const { projectKey } = await ctx.params;
    const workspace = resolveWorkspace(projectKey);
    if (!workspace) {
        return NextResponse.json(
            { statusMessage: "workspace not found" },
            { status: 404 }
        );
    }
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const files: FileEntry[] = getFileIndex(projectKey, workspace.rootPath);
    const out = q
        ? files
              .filter(
                  (f) =>
                      f.path.toLowerCase().includes(q) ||
                      f.name.toLowerCase().includes(q)
              )
              .slice(0, 20)
        : files.slice(0, 20);
    return NextResponse.json(out);
}
