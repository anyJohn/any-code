import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import ignore from "ignore";

/**
 * workspace 文件索引：collect 全部非忽略文件（不按 q 过滤），per projectKey 缓存，
 * 供 /files 多次 q 查询复用 + /chat 加载时预热。SPEC-020。
 */
export interface FileEntry {
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
const TTL = 60_000; // 预热后长有效，过期自然重建

const cache = new Map<string, { files: FileEntry[]; ts: number }>();

// 收集 dir 及其子目录中的 .gitignore 规则，挂到传入的 ignore 实例上。
// gitignore 规则相对于所在 .gitignore 文件所在目录，因此用相对 base 计算前缀。
function loadGitignores(base: string, dir: string, ig: ignore.Ignore): void {
    let entries: Dirent<string>[];
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    const gi = entries.find((e) => e.isFile() && e.name === ".gitignore");
    if (gi) {
        try {
            const content = readFileSync(join(dir, ".gitignore"), "utf-8");
            const relDir = relative(base, dir).split(sep).join("/");
            const reweighted = content
                .split("\n")
                .map((line) => {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith("#")) return "";
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
    for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (SKIP_DIRS.has(ent.name)) continue;
        const child = join(dir, ent.name);
        const rel = relative(base, child).split(sep).join("/");
        if (rel && ig.ignores(rel)) continue;
        loadGitignores(base, child, ig);
    }
}

/** 收集 dir 子树全部非忽略文件（不按 q 过滤），上限 COLLECT_CAP。 */
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

function isFresh(projectKey: string): boolean {
    const hit = cache.get(projectKey);
    return !!hit && Date.now() - hit.ts < TTL;
}

/** 取文件索引：命中缓存返回；miss 同步 collect + 缓存。 */
export function getFileIndex(
    projectKey: string,
    rootPath: string
): FileEntry[] {
    if (isFresh(projectKey)) return cache.get(projectKey)!.files;
    const ig = ignore();
    loadGitignores(rootPath, rootPath, ig);
    const files: FileEntry[] = [];
    collectFiles(rootPath, rootPath, ig, files, MAX_DEPTH);
    cache.set(projectKey, { files, ts: Date.now() });
    return files;
}

/**
 * 预热：fresh 则 skip；否则 setImmediate 后台 collect 填缓存（不阻塞调用方）。
 * 进 chat（status route）即触发，@ 检索时已缓存好。
 */
export function preloadFileIndex(projectKey: string, rootPath: string): void {
    if (isFresh(projectKey)) return;
    setImmediate(() => {
        if (isFresh(projectKey)) return; // 期间可能已被填
        getFileIndex(projectKey, rootPath);
    });
}
