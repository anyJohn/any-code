import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { globalConfigDir } from "./workspace";
import { projectKeyOf } from "./session";

/**
 * 工作区快照与回滚（AR-4）：shadow-git 实现。
 *
 * - 快照仓库与项目目录零污染：集中存于 ~/.anycode/snapshots/<projectKey>/（独立 git dir），
 *   工作树指向 workspace；blob 去重由 git 天然提供。
 * - 快照 = git add -A + commit（-c 注入身份，隔离宿主 git 配置）。
 * - 回滚 = git checkout <hash> -- .（恢复快照时点已跟踪文件；快照之后新建且未跟踪的
 *   文件不删除——v1 语义，回滚前必须经用户确认）。
 * - git 不可用（如 busybox-only Windows 环境）→ available:false，快照静默跳过 + 一次性告警。
 */

export interface Snapshot {
    /** commit hash（回滚 id） */
    id: string;
    /** 说明（工具名 + 参数摘要） */
    label: string;
    ts: number;
}

export interface SnapshotService {
    /** git 可用性（首次探测后缓存） */
    available(): boolean;
    /** 工作区快照；失败/不可用返回 null（best-effort，不阻断工具执行） */
    snapshot(label: string): Snapshot | null;
    /** 快照列表（新→旧） */
    list(): Snapshot[];
    /** 回滚工作区到指定快照（恢复该时点已跟踪文件）。失败抛错由调用方处理。 */
    rollbackTo(id: string): void;
}

const GIT_TIMEOUT_MS = 30_000;

/** 隔离宿主 git 配置（hermes 同构）：不读全局/系统配置，注入本地身份。 */
function gitEnv(): Record<string, string> {
    return {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
    };
}

function runGit(args: string[], gitDir: string, workTree?: string): { ok: boolean; out: string } {
    const full = workTree
        ? ["--git-dir", gitDir, "--work-tree", workTree, ...args]
        : ["--git-dir", gitDir, ...args];
    const r = spawnSync("git", full, {
        env: gitEnv(),
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        encoding: "utf-8",
    });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** 探测 git 是否可用（缓存）。 */
let gitAvailableCache: boolean | undefined;
export function gitAvailable(): boolean {
    if (gitAvailableCache !== undefined) return gitAvailableCache;
    try {
        const r = spawnSync("git", ["--version"], { timeout: 5000, windowsHide: true });
        gitAvailableCache = r.status === 0;
    } catch {
        gitAvailableCache = false;
    }
    return gitAvailableCache;
}

/** 快照仓库根：~/.anycode/snapshots/<projectKey>/ */
function shadowDir(workspaceRoot: string): string {
    return path.join(globalConfigDir(), "snapshots", projectKeyOf(workspaceRoot));
}

/** 创建 per-workspace 快照服务。构造时惰性初始化 shadow 仓库。 */
export function createSnapshotService(workspaceRoot: string): SnapshotService {
    const repoRoot = shadowDir(workspaceRoot);
    /** 普通仓库初始化在 repoRoot，其 .git 才是 git-dir（git init <dir> 语义） */
    const gitDir = path.join(repoRoot, ".git");
    let initialized = false;

    const ensureRepo = (): boolean => {
        if (!gitAvailable()) return false;
        if (initialized) return true;
        try {
            fs.mkdirSync(path.dirname(repoRoot), { recursive: true });
            if (!fs.existsSync(path.join(gitDir, "HEAD"))) {
                // 尚未初始化：git init <repoRoot>（普通仓库，--git-dir 指向其 .git）
                const r = spawnSync("git", ["init", "--quiet", repoRoot], {
                    env: gitEnv(),
                    timeout: GIT_TIMEOUT_MS,
                    windowsHide: true,
                    encoding: "utf-8",
                });
                if (r.status !== 0) return false;
            }
            initialized = true;
        } catch {
            return false;
        }
        return true;
    };

    const commitish = (label: string): Snapshot | null => {
        // 读 HEAD 作为本次快照 hash（commit 可能是 no-op 复用旧 hash）
        const head = runGit(["rev-parse", "HEAD"], gitDir);
        if (!head.ok) return null;
        return { id: head.out.trim(), label, ts: Date.now() };
    };

    return {
        available: () => ensureRepo(),

        snapshot(label: string): Snapshot | null {
            if (!ensureRepo()) return null;
            // add -A + commit（快照与工作树对齐；无变更时 commit 失败 → 复用 HEAD）
            const add = runGit(["add", "-A", "--"], gitDir, workspaceRoot);
            if (!add.ok) return null;
            const commit = runGit(
                [
                    "-c", "user.name=anycode",
                    "-c", "user.email=anycode@local",
                    "commit", "--quiet", "--allow-empty", "-m", label,
                ],
                gitDir,
                workspaceRoot
            );
            if (!commit.ok) return null;
            return commitish(label);
        },

        list(): Snapshot[] {
            if (!ensureRepo()) return [];
            const log = runGit(
                ["log", "--format=%H%x1f%s%x1f%ct", "--date-order", "-50"],
                gitDir
            );
            if (!log.ok) return [];
            return log.out
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                    const [id, label, ts] = line.split("\x1f");
                    return { id, label, ts: Number(ts) * 1000 };
                });
        },

        rollbackTo(id: string): void {
            if (!ensureRepo()) throw new Error("git 不可用，无法回滚");
            // hash 格式白名单先行（防参数注入 checkout）
            if (!/^[0-9a-f]{7,40}$/.test(id)) throw new Error("非法快照 id");
            // 校验 id 存在（回滚目标必须来自 list，不接受任意 hash）
            const known = this.list().some((s) => s.id === id);
            if (!known) throw new Error(`快照 ${id} 不存在`);
            const co = runGit(["checkout", id, "--", "."], gitDir, workspaceRoot);
            if (!co.ok) throw new Error(`回滚失败：${co.out.trim()}`);
        },
    };
}
