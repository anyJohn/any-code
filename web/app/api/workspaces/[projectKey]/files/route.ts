import { NextResponse } from "next/server";
import {
    WorkspaceRegistry,
    createWorkspace,
    runRipgrep,
    type Workspace,
} from "@any-code/domain";
import { basename } from "node:path";

function resolveWorkspace(projectKey: string): Workspace | null {
    const meta = WorkspaceRegistry.list().find((w) => w.projectKey === projectKey);
    return meta ? createWorkspace(meta.rootPath) : null;
}

interface FileEntry {
    path: string;
    name: string;
}

// GET /api/workspaces/:projectKey/files?q=<prefix> —— 用 ripgrep `rg --files` 实时枚举
// （尊重 .gitignore、默认跳 VCS/node_modules），JS substring 过滤 + slice 20。
// 不预热不缓存（rg --files 中型仓 < 30ms）。SPEC-021 B-004 / DEC-074。
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
    const { stdout } = await runRipgrep(["--files"], {
        cwd: workspace.rootPath,
    });
    const all: FileEntry[] = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((p) => ({ path: p, name: basename(p) }));
    const out = q
        ? all
              .filter(
                  (f) =>
                      f.path.toLowerCase().includes(q) ||
                      f.name.toLowerCase().includes(q)
              )
              .slice(0, 20)
        : all.slice(0, 20);
    return NextResponse.json(out);
}
