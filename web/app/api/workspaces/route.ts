import { NextResponse } from "next/server";
import { WorkspaceRegistry } from "@any-code/domain";
import fs from "node:fs";

// GET /api/workspaces —— 列出所有已注册工作区（按 lastUsedAt 降序）
export async function GET() {
    return NextResponse.json(WorkspaceRegistry.list());
}

// POST /api/workspaces  body: { path } —— 注册一个工作区目录
export async function POST(req: Request) {
    let body: { path?: string } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    const p = body?.path?.trim();
    if (!p) {
        return NextResponse.json(
            { statusMessage: "path required" },
            { status: 400 }
        );
    }
    try {
        const stat = fs.statSync(p);
        if (!stat.isDirectory()) {
            return NextResponse.json(
                { statusMessage: "not a directory" },
                { status: 400 }
            );
        }
    } catch (e) {
        return NextResponse.json(
            {
                statusMessage: `path not accessible: ${
                    e instanceof Error ? e.message : ""
                }`,
            },
            { status: 400 }
        );
    }
    return NextResponse.json(WorkspaceRegistry.add(p));
}

// DELETE /api/workspaces  body: { path } —— 从注册表移除工作区（不删磁盘文件）
export async function DELETE(req: Request) {
    let body: { path?: string } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    const p = body?.path?.trim();
    if (!p) {
        return NextResponse.json(
            { statusMessage: "path required" },
            { status: 400 }
        );
    }
    WorkspaceRegistry.remove(p);
    return NextResponse.json({ status: "removed" });
}
