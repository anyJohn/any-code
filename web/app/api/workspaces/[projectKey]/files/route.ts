import { NextResponse } from "next/server";
import {
    WorkspaceRegistry,
    createWorkspace,
    type Workspace,
} from "@any-code/domain";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import ignore from "ignore";

function resolveWorkspace(projectKey: string): Workspace | null {
    const meta = WorkspaceRegistry.list().find((w) => w.projectKey === projectKey);
    return meta ? createWorkspace(meta.rootPath) : null;
}

interface FileEntry {
    path: string;
    name: string;
}

const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    ".cache",
    ".anycode",
]);

const MAX_DEPTH = 8;
const COLLECT_CAP = 2000; // 收集上限，避免巨型工作区内存爆炸

// 收集 dir 子树全部非忽略文件（不按 q 过滤），供缓存后多次 q 查询复用。
function collectFiles(
    base: string,
    dir: string,
    ig: ignore.Ignore,
    out: FileEntry[],
    depth: number
): void {
    if (out.length >= COLLECT_CAP || depth <= 0) return;
    let entries: Dirent<string>[];
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        if (out.length >= COLLECT_CAP) return;
        if (ent.isDirectory()) {
            if (SKIP_DIRS.has(ent.name)) continue;
            const child = join(dir, ent.name);
            const relDir = relative(base, child).split(sep).join("/");
            if (relDir && ig.ignores(relDir)) continue;
            collectFiles(base, child, ig, out, depth - 1);
        } else if (ent.isFile()) {
            const full = join(dir, ent.name);
            const rel = relative(base, full).split(sep).join("/");
            if (ig.ignores(rel)) continue;
            out.push({ path: rel, name: ent.name });
        }
    }
}

// 收集 dir 及其子目录中的 .gitignore 规则，挂到传入的 ignore 实例上。
// gitignore 规则相对于所在 .gitignore 文件所在目录，因此用相对 base 计算前缀。
function loadGitignores(
    base: string,
    dir: string,
    ig: ignore.Ignore
): void {
    let entries: Dirent<string>[];
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    const gi = entries.find(
        (e) => e.isFile() && e.name === ".gitignore"
    );
    if (gi) {
        try {
            const content = readFileSync(join(dir, ".gitignore"), "utf-8");
            const relDir = relative(base, dir).split(sep).join("/");
            // 将规则按所在目录重写为相对 base 的路径前缀，使单实例匹配整树。
            const reweighted = content
                .split("\n")
                .map((line) => {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith("#")) return "";
                    // 绝对路径规则（带前导 /）→ 相对当前目录根
                    if (trimmed.startsWith("/")) {
                        return relDir
                            ? `${relDir}/${trimmed.slice(1)}`
                            : trimmed.slice(1);
                    }
                    return relDir ? `${relDir}/${trimmed}` : trimmed;
                })
                .filter(Boolean)
                .join("\n");
            ig.add(reweighted);
        } catch {
            // 读失败 → 跳过该 .gitignore
        }
    }
    // 递归子目录
    for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (SKIP_DIRS.has(ent.name)) continue;
        const child = join(dir, ent.name);
        const rel = relative(base, child).split(sep).join("/");
        if (rel && ig.ignores(rel)) continue; // 父 .gitignore 已忽略该目录
        loadGitignores(base, child, ig);
    }
}

// GET /api/workspaces/:projectKey/files?q=<prefix> —— 递归扫描工作区文件，
// 文件名或相对路径包含 q（大小写不敏感子串）即命中，上限 20 条。
// 尊重 .gitignore（根目录与嵌套 .gitignore），跳过 node_modules/.git/.next/dist/.cache/.anycode。
// 缓存：全树 collect 一次（含 gitignore 收集），5s 内同 workspace 的 q 查询走内存过滤。
const fileCache = new Map<string, { files: FileEntry[]; ts: number }>();
const FILE_CACHE_TTL = 5000;

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

    let cached = fileCache.get(projectKey);
    if (!cached || Date.now() - cached.ts > FILE_CACHE_TTL) {
        const ig = ignore();
        loadGitignores(workspace.rootPath, workspace.rootPath, ig);
        const files: FileEntry[] = [];
        collectFiles(
            workspace.rootPath,
            workspace.rootPath,
            ig,
            files,
            MAX_DEPTH
        );
        cached = { files, ts: Date.now() };
        fileCache.set(projectKey, cached);
    }
    const out = q
        ? cached.files
              .filter(
                  (f) =>
                      f.path.toLowerCase().includes(q) ||
                      f.name.toLowerCase().includes(q)
              )
              .slice(0, 20)
        : cached.files.slice(0, 20);
    return NextResponse.json(out);
}
