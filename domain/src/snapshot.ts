import { spawn, spawnSync } from "node:child_process";
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
 * - 回滚 = git checkout <hash> -- .（cwd 锚定 workspaceRoot，pathspec 不随进程 cwd 漂移）。
 * - git 二进制跨平台解析（PATH → gitBashPath 同目录 → 系统 Git for Windows），
 *   探测失败一次性 console.warn（AR-4 头注释承诺）。
 * - 全部 git 调用异步（spawn + await）——快照挂在工具执行路径上，
 *   同步 spawn 会阻塞单进程 server 的事件循环（code-review 发现 #1）。
 */

export interface Snapshot {
    /** commit hash（回滚 id） */
    id: string;
    ts: number;
    /** 触发快照的会话 id（run 起点快照为当前会话；手工调用可为 null） */
    sessionId: string | null;
    /** 触发快照的命令（工具名 + 参数摘要）。domain 只存事实——展示用 label 由 interface 层自行拼接 */
    command: string;
    /** 工作树相对该快照的变更文件数（list 时计算；变更 tab 过滤无变更快照用） */
    changes: number;
}

/**
 * commit message ↔ 结构化快照事实（用户决策 2026-09-06：domain 不存展示 label，
 * 存 sessionId + command；时间戳走 git commit 时间）。
 * 旧格式（纯文本 label，或 "session <id> | <cmd>" 前缀）降级解析。
 */
export function parseSnapshotMessage(
    msg: string
): { sessionId: string | null; command: string } {
    try {
        const obj = JSON.parse(msg) as { c?: string; s?: string | null };
        if (typeof obj.c === "string") {
            return { sessionId: obj.s ?? null, command: obj.c };
        }
    } catch {
        // 非 JSON → 旧格式
    }
    const legacy = /^session ([0-9a-f-]{8,}) \| (.*)$/s.exec(msg);
    if (legacy) return { sessionId: legacy[1], command: legacy[2] };
    return { sessionId: null, command: msg };
}

function snapshotMessage(command: string, sessionId: string | null): string {
    return JSON.stringify({ c: command, s: sessionId });
}

export interface SnapshotService {
    /** git 可用性（首次解析后缓存） */
    available(): boolean;
    /** 工作区快照；失败/不可用返回 null（best-effort，不阻断工具执行） */
    snapshot(command: string, sessionId?: string | null): Promise<Snapshot | null>;
    /** 快照列表（新→旧） */
    list(): Promise<Snapshot[]>;
    /** 回滚工作区到指定快照（恢复该时点已跟踪文件）。失败抛错由调用方处理。 */
    rollbackTo(id: string): Promise<void>;
    /**
     * 工作树相对指定快照的变更（SPEC-036 B-007，变更 tab）：
     * status 为 git name-status（A/M/D/R…），patch 为统一 diff 文本。
     * path 可选——限定单文件。id 必须来自 list（防参数注入）。
     */
    diffFrom(
        id: string,
        path?: string
    ): Promise<{ files: { path: string; status: string }[]; patch: string }>;
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

/** 异步 git 调用（不阻塞事件循环）；cwd 显式锚定，pathspec 不随进程 cwd 漂移。 */
function runGit(
    args: string[],
    gitDir: string,
    opts: { workTree?: string; cwd?: string }
): Promise<{ ok: boolean; out: string }> {
    const full = [
        "--git-dir", gitDir,
        ...(opts.workTree ? ["--work-tree", opts.workTree] : []),
        ...args,
    ];
    return new Promise((resolve) => {
        const child = spawn("git", full, {
            env: gitEnv(),
            cwd: opts.cwd,
            windowsHide: true,
        });
        let out = "";
        const timer = setTimeout(() => child.kill("SIGKILL"), GIT_TIMEOUT_MS);
        child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
        child.stderr?.on("data", (c: Buffer) => (out += c.toString()));
        child.on("error", () => {
            clearTimeout(timer);
            resolve({ ok: false, out });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ ok: code === 0, out });
        });
    });
}

// ── git 二进制解析（跨平台；code-review 发现 #10）──

let resolvedGit: string | null | undefined;
let warnedUnavailable = false;

/**
 * 解析 git 可执行文件：PATH → gitBashPath 同目录（PortableGit/bin 下 git.exe 与 bash.exe
 * 同伴）→ 系统 Git for Windows。解析结果进程级缓存。
 */
export function resolveGitPath(gitHint?: string): string | null {
    if (resolvedGit !== undefined) return resolvedGit;
    const candidates: string[] = ["git"];
    if (process.platform === "win32") {
        if (gitHint) {
            const dir = path.dirname(gitHint);
            candidates.unshift(path.join(dir, "git.exe"), path.join(dir, "..", "cmd", "git.exe"));
        }
        candidates.push("C:\\Program Files\\Git\\bin\\git.exe", "C:\\Program Files\\Git\\cmd\\git.exe");
    }
    for (const c of candidates) {
        try {
            if (spawnSync(c, ["--version"], { timeout: 5000, windowsHide: true }).status === 0) {
                resolvedGit = c;
                return c;
            }
        } catch {
            // 探测失败继续下一候选
        }
    }
    resolvedGit = null;
    return null;
}

/** git 不可用时的一次性告警（AR-4 头注释承诺）。 */
function warnGitUnavailableOnce(): void {
    if (warnedUnavailable) return;
    warnedUnavailable = true;
    console.warn("[Snapshot] git 不可用，快照功能已停用（写类操作将没有回滚点）");
}

/** 快照仓库根：~/.anycode/snapshots/<projectKey>/ */
function shadowDir(workspaceRoot: string): string {
    return path.join(globalConfigDir(), "snapshots", projectKeyOf(workspaceRoot));
}

/** 创建 per-workspace 快照服务。ignoredPatterns 写入 shadow 仓库 exclude，
 * 防 git add -A 吞 node_modules 等巨量目录（code-review 发现 #1）。 */
export function createSnapshotService(
    workspaceRoot: string,
    ignoredPatterns: string[] = [],
    gitHint?: string
): SnapshotService {
    const repoRoot = shadowDir(workspaceRoot);
    /** 普通仓库初始化在 repoRoot，其 .git 才是 git-dir（git init <dir> 语义） */
    const gitDir = path.join(repoRoot, ".git");
    let initialized = false;

    const git = (): string | null => {
        const p = resolveGitPath(gitHint);
        if (!p) warnGitUnavailableOnce();
        return p;
    };

    const ensureRepo = async (): Promise<boolean> => {
        const bin = git();
        if (!bin) return false;
        if (initialized) return true;
        try {
            fs.mkdirSync(path.dirname(repoRoot), { recursive: true });
            if (!fs.existsSync(path.join(gitDir, "HEAD"))) {
                // 尚未初始化：git init <repoRoot>（不能带 --git-dir——目录此时还不存在）
                const r = await new Promise<{ ok: boolean; out: string }>((resolve) => {
                    // 不能设 cwd=repoRoot（此时还不存在，spawn 会 ENOENT）
                    const c = spawn("git", ["init", "--quiet", repoRoot], {
                        env: gitEnv(),
                        windowsHide: true,
                    });
                    let out = "";
                    c.stdout?.on("data", (d: Buffer) => (out += d.toString()));
                    c.stderr?.on("data", (d: Buffer) => (out += d.toString()));
                    c.on("error", () => resolve({ ok: false, out }));
                    c.on("close", (code) => resolve({ ok: code === 0, out }));
                });
                if (!r.ok) return false;
                // exclude：把常见巨量目录挡在 add 之外（workspace ignore 语义对齐）
                const excludes = [".git", ...ignoredPatterns].map((p) => `/${p}`).join("\n");
                try {
                    fs.writeFileSync(path.join(gitDir, "info", "exclude"), excludes + "\n", "utf-8");
                } catch {
                    // exclude 写失败不阻断（退化为全量 add）
                }
            }
            initialized = true;
        } catch {
            return false;
        }
        return true;
    };

    const commitish = async (
        command: string,
        sessionId: string | null
    ): Promise<Snapshot | null> => {
        const head = await runGit(["rev-parse", "HEAD"], gitDir, { cwd: workspaceRoot });
        if (!head.ok) return null;
        // changes 由 list() 统一计算回填；刚拍的快照此刻必然 0（与工作树一致）
        return { id: head.out.trim(), command, sessionId, ts: Date.now(), changes: 0 };
    };

    return {
        available: (): boolean => resolveGitPath(gitHint) !== null,

        async snapshot(command: string, sessionId?: string | null): Promise<Snapshot | null> {
            if (!(await ensureRepo())) return null;
            const add = await runGit(["add", "-A", "--"], gitDir, {
                workTree: workspaceRoot,
                cwd: workspaceRoot,
            });
            if (!add.ok) return null;
            const commit = await runGit(
                [
                    "-c", "user.name=anycode",
                    "-c", "user.email=anycode@local",
                    "commit", "--quiet", "--allow-empty", "-m", snapshotMessage(command, sessionId ?? null),
                ],
                gitDir,
                { workTree: workspaceRoot, cwd: workspaceRoot }
            );
            if (!commit.ok) return null;
            return commitish(command, sessionId ?? null);
        },

        async list(): Promise<Snapshot[]> {
            if (!(await ensureRepo())) return [];
            const log = await runGit(
                ["log", "--format=%H%x1f%s%x1f%ct", "--date-order", "-50"],
                gitDir,
                { cwd: workspaceRoot }
            );
            if (!log.ok) return [];
            const base = log.out
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                    const [id, msg, ts] = line.split("\x1f");
                    const { sessionId, command } = parseSnapshotMessage(msg);
                    return { id, sessionId, command, ts: Number(ts) * 1000 };
                });
            // 每快照的变更文件数（SPEC-036 / 用户反馈 2026-09-06）：变更 tab 过滤
            // 无变更快照。未跟踪文件先 intent-to-add 登记；8 并发控 git 进程数。
            await runGit(["add", "--intent-to-add", "-A"], gitDir, {
                workTree: workspaceRoot,
                cwd: workspaceRoot,
            });
            const countFor = async (id: string): Promise<number> => {
                const d = await runGit(["diff", "--name-only", id], gitDir, {
                    workTree: workspaceRoot,
                    cwd: workspaceRoot,
                });
                return d.ok
                    ? d.out.split("\n").filter(Boolean).length
                    : 0;
            };
            const counts = new Map<string, number>();
            for (let i = 0; i < base.length; i += 8) {
                await Promise.all(
                    base.slice(i, i + 8).map(async (s) => {
                        counts.set(s.id, await countFor(s.id));
                    })
                );
            }
            return base.map((s) => ({ ...s, changes: counts.get(s.id) ?? 0 }));
        },

        async rollbackTo(id: string): Promise<void> {
            if (!(await ensureRepo())) throw new Error("git 不可用，无法回滚");
            // hash 格式白名单先行（防参数注入 checkout）
            if (!/^[0-9a-f]{7,40}$/.test(id)) throw new Error("非法快照 id");
            // 校验 id 存在（回滚目标必须来自 list，不接受任意 hash）
            const known = (await this.list()).some((s) => s.id === id);
            if (!known) throw new Error(`快照 ${id} 不存在`);
            // cwd 锚定 workspaceRoot：pathspec "." 不随 server 进程 cwd 漂移（code-review 发现 #2）
            const co = await runGit(["checkout", id, "--", "."], gitDir, {
                workTree: workspaceRoot,
                cwd: workspaceRoot,
            });
            if (!co.ok) throw new Error(`回滚失败：${co.out.trim()}`);
        },

        async diffFrom(id, path) {
            if (!(await ensureRepo()))
                throw new Error("git 不可用，无法对比快照");
            if (!/^[0-9a-f]{7,40}$/.test(id)) throw new Error("非法快照 id");
            const known = (await this.list()).some((s) => s.id === id);
            if (!known) throw new Error(`快照 ${id} 不存在`);
            // 新建未跟踪文件不进 git diff——先 intent-to-add 登记为空 blob（shadow 仓库 index，无副作用）
            await runGit(["add", "--intent-to-add", "-A"], gitDir, {
                workTree: workspaceRoot,
                cwd: workspaceRoot,
            });
            const pathArgs = path ? ["--", path] : [];
            const [st, patch] = await Promise.all([
                runGit(["diff", "--name-status", id, ...pathArgs], gitDir, {
                    workTree: workspaceRoot,
                    cwd: workspaceRoot,
                }),
                runGit(["diff", id, ...pathArgs], gitDir, {
                    workTree: workspaceRoot,
                    cwd: workspaceRoot,
                }),
            ]);
            if (!st.ok) throw new Error(`对比失败：${st.out.trim()}`);
            const files = st.out
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                    const [status, ...rest] = line.split("\t");
                    return { status, path: rest.join("\t") };
                });
            return { files, patch: patch.ok ? patch.out : "" };
        },
    };
}
