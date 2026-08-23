import { NextResponse } from "next/server";
import {
    WorkspaceRegistry,
    Config,
    createWorkspace,
    workspaceConfigDir,
    type Workspace,
} from "@any-code/domain";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function resolveWorkspace(projectKey: string): Workspace | null {
    const meta = WorkspaceRegistry.list().find((w) => w.projectKey === projectKey);
    return meta ? createWorkspace(meta.rootPath) : null;
}

interface StatusResponse {
    provider: string;
    model: string;
    contextWindow: number;
    skillCount: number;
    skillNames: string[];
    mcpServers: { name: string; type: string }[];
}

const EMPTY: StatusResponse = {
    provider: "",
    model: "",
    contextWindow: 128000,
    skillCount: 0,
    skillNames: [],
    mcpServers: [],
};

// GET /api/workspaces/:projectKey/status —— 底部状态条静态信息
export async function GET(
    _req: Request,
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

    let cfg: Config | null = null;
    try {
        cfg = Config.load();
    } catch {
        // 无配置 → 返回空骨架，状态条仍渲染
        return NextResponse.json(EMPTY);
    }

    const provider = cfg.getCurrentProvider();
    const mcpServers = Object.entries(cfg.mcpServers).map(([name, s]) => ({
        name,
        type: s.type ?? "",
    }));

    // 技能：读 <workspace>/.anycode/skills/ 下 *.md 文件名
    const skillsDir = join(workspaceConfigDir(workspace), "skills");
    let skillNames: string[] = [];
    try {
        const entries = readdirSync(skillsDir, { withFileTypes: true });
        skillNames = entries
            .filter((e) => e.isFile() && e.name.endsWith(".md"))
            .map((e) => e.name.slice(0, -3));
    } catch {
        // 目录不存在 → 0 个技能
    }

    return NextResponse.json({
        provider: cfg.default,
        model: provider.model,
        contextWindow: provider.contextWindow,
        skillCount: skillNames.length,
        skillNames,
        mcpServers,
    });
}
