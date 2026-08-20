import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextResponse } from "next/server";

// GET /api/fs/browse?dir=<path> —— 服务端目录浏览（目录选择器用）
//   浏览器原生 file dialog 拿不到绝对路径，只能服务端读 fs 返回目录树。
//   只返回目录（选工作区用），不返回文件；隐藏目录不展示。
export async function GET(req: Request) {
    const url = new URL(req.url);
    const requested = url.searchParams.get("dir") || os.homedir();

    let resolved = path.resolve(requested);
    try {
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
            resolved = path.dirname(resolved); // 文件路径 → 退到父目录
        }
    } catch {
        resolved = os.homedir(); // 不存在 → 退回 home
    }

    let dirs: { name: string; path: string }[] = [];
    try {
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        dirs = entries
            .filter(
                (e) => e.isDirectory() && !e.name.startsWith(".") // 隐藏目录不展示
            )
            .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        // 无读权限等，返回空
    }

    return NextResponse.json({
        current: resolved,
        parent:
            resolved === path.parse(resolved).root ? null : path.dirname(resolved),
        dirs,
    });
}
