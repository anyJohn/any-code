import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// GET /api/fs/browse?dir=<path> —— 服务端目录浏览（目录选择器用）
// 浏览器原生 file dialog 拿不到绝对路径，只能服务端读 fs 返回目录树。
// 前提：Nitro 与用户同机（本地 agent）。只返回目录（选工作区用），不返回文件。
export default defineEventHandler((event) => {
    const query = getQuery(event);
    const requested = (query.dir as string) || os.homedir();

    let resolved = path.resolve(requested);
    let stat;
    try {
        stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
            // 给了文件路径 → 退到其父目录
            resolved = path.dirname(resolved);
        }
    } catch {
        // 路径不存在 → 退回 home
        resolved = os.homedir();
    }

    let dirs: { name: string; path: string }[] = [];
    try {
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        dirs = entries
            .filter(
                (e) =>
                    e.isDirectory() &&
                    !e.name.startsWith(".") // 隐藏目录不展示（.git/.anycode 等）
            )
            .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        // 无读权限等，返回空
    }

    return {
        current: resolved,
        parent: resolved === path.parse(resolved).root ? null : path.dirname(resolved),
        dirs,
    };
});
