import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextResponse } from "next/server";

// GET /api/fs/browse?dir=<path> —— 服务端目录浏览（目录选择器用）
//   浏览器原生 file dialog 拿不到绝对路径，只能服务端读 fs 返回目录树。
//   只返回目录（选工作区用），不返回文件；隐藏目录不展示。
//
// Windows 盘符视图：盘根（C:\）的 parent 指向 DRIVES_SENTINEL，browse(sentinel)
// 返回所有可用盘符（C:-Z: 探测）。修"上到 C:\ 就卡死、切不到 D:/E:"的 bug。
// Linux/mac 不触发（无盘符概念，/ 的 parent=null）。
const DRIVES_SENTINEL = "::drives::";
const isWin = process.platform === "win32";

function listDrives(): { name: string; path: string }[] {
    const out: { name: string; path: string }[] = [];
    for (let c = 67; c <= 90; c++) {
        // C..Z（跳过 A/B 软驱年代）
        const letter = String.fromCharCode(c);
        const root = `${letter}:\\`;
        try {
            fs.accessSync(root);
            out.push({ name: `${letter}:`, path: root });
        } catch {
            // 盘不存在/无权限
        }
    }
    return out;
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const requested = url.searchParams.get("dir") || "";

    // Windows 盘符视图（从盘根"上级"到这里）
    if (isWin && requested === DRIVES_SENTINEL) {
        return NextResponse.json({
            current: "此电脑",
            parent: null,
            dirs: listDrives(),
        });
    }

    const start = requested || os.homedir();
    let resolved = path.resolve(start);
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

    const root = path.parse(resolved).root;
    const parent =
        resolved === root
            ? isWin
                ? DRIVES_SENTINEL // Windows 盘根 → 上级到盘符视图
                : null // Linux/mac / → 顶层
            : path.dirname(resolved);

    return NextResponse.json({ current: resolved, parent, dirs });
}
