import { NextResponse } from "next/server";
import {
    WorkspaceRegistry,
    createWorkspace,
    workspaceConfigDir,
    type Workspace,
} from "@any-code/domain";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function resolveWorkspace(projectKey: string): Workspace | null {
    const meta = WorkspaceRegistry.list().find((w) => w.projectKey === projectKey);
    return meta ? createWorkspace(meta.rootPath) : null;
}

interface CustomCommand {
    name: string;
    body: string;
}

// GET /api/workspaces/:projectKey/commands —— 自定义斜杠命令模板
// 文件名（去 .md）= 命令名，正文 = 提示模板；选中后作为普通用户消息提交。
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
    const dir = join(workspaceConfigDir(workspace), "commands");
    let names: string[] = [];
    try {
        names = readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith(".md"))
            .map((e) => e.name);
    } catch {
        // 目录不存在 → 无自定义命令
        return NextResponse.json([]);
    }
    const commands: CustomCommand[] = names.map((name) => {
        const body = readFileSync(join(dir, name), "utf-8");
        return { name: name.slice(0, -3), body };
    });
    return NextResponse.json(commands);
}
