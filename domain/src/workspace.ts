/**
 * Workspace —— Agent 的活动范围（上下文边界，非安全边界）。
 * 把原本隐含在 process.cwd() 里的"当前项目"显式化成对象，
 * 供 Session/Rules/Skills/Tools 统一引用。详见 docs/workspace设计.md。
 *
 * 安全（能不能做）由将来的 Permission 系统负责；Workspace 只管"在哪儿做"。
 */
import fs from "fs";
import path from "path";
import os from "os";
import { projectKeyOf } from "./session";

export interface Workspace {
    /** realpath 归一后的绝对根路径。bash cwd / 文件解析都以此为锚。 */
    rootPath: string;
    /** 检索忽略模式（grep/glob/explore 默认用），与安全无关，只为减噪。 */
    ignoredPatterns: string[];
}

/** 注册表里的一条工作区元数据（侧栏列表用） */
export interface WorkspaceMeta {
    rootPath: string;
    projectKey: string;
    name: string;
    addedAt: number;
    lastUsedAt: number;
}

const REGISTRY_DIR = path.join(os.homedir(), ".anycode");
const REGISTRY_FILE = path.join(REGISTRY_DIR, "workspaces.json");

const DEFAULT_IGNORED_PATTERNS = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    ".DS_Store",
];

/** realpath 解符号链接，保证同目录不同写法（尾斜杠/相对/软链）不重复注册 */
function normalizeRoot(rootPath: string): string {
    const resolved = path.resolve(rootPath);
    try {
        return fs.realpathSync(resolved);
    } catch {
        // 目录暂不存在（创建工作区前可能还没建）—— 用 resolve 结果
        return resolved;
    }
}

function loadRegistry(): WorkspaceMeta[] {
    try {
        if (!fs.existsSync(REGISTRY_FILE)) return [];
        const list = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8"));
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function saveRegistry(list: WorkspaceMeta[]) {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(list, null, 2), "utf-8");
}

/** 工作区注册表：全局持久化（~/.anycode/workspaces.json），跨项目。 */
export const WorkspaceRegistry = {
    list(): WorkspaceMeta[] {
        return loadRegistry().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    },

    /** 注册一个工作区。已存在则刷新 lastUsedAt。返回元数据。 */
    add(rootPath: string): WorkspaceMeta {
        const root = normalizeRoot(rootPath);
        const list = loadRegistry();
        const existing = list.find((w) => w.rootPath === root);
        if (existing) {
            existing.lastUsedAt = Date.now();
            saveRegistry(list);
            return existing;
        }
        const meta: WorkspaceMeta = {
            rootPath: root,
            projectKey: projectKeyOf(root),
            name: path.basename(root) || root,
            addedAt: Date.now(),
            lastUsedAt: Date.now(),
        };
        list.push(meta);
        saveRegistry(list);
        return meta;
    },

    remove(rootPath: string): void {
        const root = normalizeRoot(rootPath);
        saveRegistry(loadRegistry().filter((w) => w.rootPath !== root));
    },
};

/** 构造 Workspace 对象（纯内存，不建目录、不复制文件） */
export function createWorkspace(rootPath: string): Workspace {
    return {
        rootPath: normalizeRoot(rootPath),
        ignoredPatterns: [...DEFAULT_IGNORED_PATTERNS],
    };
}

/**
 * 路径解析：相对路径相对 rootPath；解析后须落在 rootPath 内，否则抛逃逸错。
 * 逃逸错误会回传 LLM，让它知道是越界而非文件不存在，下轮自行调整路径。
 * 注意：这是上下文边界（防 LLM 拼错路径读到 workspace 外），不是安全沙箱。
 */
/**
 * 解析 + 逃逸标记（B-013 改造：edit/write 逃逸走权限 ask 而非硬拒绝——
 * 硬拒绝把模型逼去 bash 绕道，反而绕开了文件工具的快照/审计通道）。
 * 调用方决定逃逸后的策略（工具层触发 PermissionAsk）。
 */
export function resolvePathWithEscape(
    workspace: Workspace,
    userPath: string
): { abs: string; escaped: boolean } {
    const abs = path.resolve(workspace.rootPath, userPath);
    const rel = path.relative(workspace.rootPath, abs);
    const escaped = rel.startsWith("..") || path.isAbsolute(rel);
    return { abs, escaped };
}

export function resolvePath(workspace: Workspace, userPath: string): string {
    const resolved = path.resolve(workspace.rootPath, userPath);
    const rel = path.relative(workspace.rootPath, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(
            `路径逃逸: ${userPath}（超出工作区 ${workspace.rootPath}）`
        );
    }
    return resolved;
}

/** 工作区本地配置目录：<rootPath>/.anycode（mcp.yaml / memory.md / skills；项目规则用 AGENTS.md） */
export function workspaceConfigDir(workspace: Workspace): string {
    return path.join(workspace.rootPath, ".anycode");
}

/** 全局配置目录：~/.anycode（调用时算 os.homedir，便于测试用临时 HOME 覆盖；registry 仍用冻结的 REGISTRY_DIR） */
export function globalConfigDir(): string {
    return path.join(os.homedir(), ".anycode");
}

/** 全局记忆文件：~/.anycode/memory.md（跨项目通用记忆）。 */
export function globalMemoryFile(): string {
    return path.join(REGISTRY_DIR, "memory.md");
}
