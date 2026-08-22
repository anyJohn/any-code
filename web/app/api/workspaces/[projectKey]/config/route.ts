import { NextResponse } from "next/server";
import {
    WorkspaceRegistry,
    Config,
    createWorkspace,
    maskApiKey,
    type ConfigShape,
    type Workspace,
} from "@any-code/domain";

function resolveWorkspace(projectKey: string): Workspace | null {
    const meta = WorkspaceRegistry.list().find((w) => w.projectKey === projectKey);
    return meta ? createWorkspace(meta.rootPath) : null;
}

// GET /api/workspaces/:projectKey/config —— 读配置（apiKey 脱敏）
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
    try {
        const cfg = Config.load(workspace);
        const providers: Record<string, unknown> = {};
        for (const [name, p] of Object.entries(cfg.providers)) {
            providers[name] = { ...p, apiKey: maskApiKey(p.apiKey) };
        }
        return NextResponse.json({
            providers,
            default: cfg.default,
            mcp: cfg.mcpServers,
        });
    } catch {
        // 无配置 → 返回空骨架，/settings 展示空表单
        return NextResponse.json({ providers: {}, default: undefined, mcp: {} });
    }
}

// POST /api/workspaces/:projectKey/config —— 写配置（校验 + 空 apiKey 保留原值）
export async function POST(
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
    let body: ConfigShape;
    try {
        body = (await req.json()) as ConfigShape;
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    // 合并：apiKey 空值保留原配置（前端编辑留空=不改）
    let existing: Config | null = null;
    try {
        existing = Config.load(workspace);
    } catch {
        // 无现有配置（首次写入）
    }
    const merged: ConfigShape = {
        providers: Object.fromEntries(
            Object.entries(body.providers ?? {}).map(([name, p]) => {
                const keep = p.apiKey?.trim()
                    ? p.apiKey
                    : existing?.providers[name]?.apiKey ?? "";
                return [name, { ...p, apiKey: keep }];
            })
        ),
        default: body.default,
        mcp: body.mcp,
    };
    try {
        Config.save(workspace, merged);
        return NextResponse.json({ statusMessage: "saved" });
    } catch (e) {
        return NextResponse.json(
            { statusMessage: (e as Error).message },
            { status: 400 }
        );
    }
}
