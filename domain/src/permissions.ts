import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import type { Workspace } from "./workspace";
import { workspaceConfigDir } from "./workspace";

/**
 * 工具权限系统（RR-026 / SPEC-032）。
 *
 * 判定顺序（B-002）：用户显式规则（项目级后评估，最后匹配生效）
 * → 内置危险命令基线（仅 bash，命中即 ask）→ 模式默认策略。
 * 规则形态 (tool, pattern) → allow|ask|deny：bash 按命令匹配（* 通配），
 * write/edit 按路径 glob（** 跨段）；其余工具仅按工具名匹配。
 * 引擎为纯函数，单测友好；危险基线可被用户配置增删（D-005）。
 */

export type PermissionAction = "allow" | "ask" | "deny";

/** 预设模式（D-008）：标准（出厂默认）/ 编辑放行 / 信任。 */
export type PermissionMode = "standard" | "accept_edits" | "trusted";

/** 一条权限规则。pattern 语义按工具：bash=命令匹配、write/edit=路径 glob、其余忽略。 */
export interface PermissionRule {
    tool: string;
    pattern?: string;
    action: PermissionAction;
}

/** 权限判定结果。source 说明命中层；ruleKey 为规则/派生模式的缓存键（D-007）。 */
export interface PermissionVerdict {
    action: PermissionAction;
    source: "rule" | "baseline" | "mode";
    /** 命中的模式描述（如 "npm *"）；allow 缓存与 UI 展示用它 */
    ruleKey?: string;
}

/** 全局 config.yaml 的 permissions 段。 */
export interface PermissionsConfig {
    mode?: PermissionMode;
    rules?: PermissionRule[];
    /** 危险命令基线模式（bash 子串匹配，大小写不敏感）；配置增删内置默认集（D-005） */
    dangerPatterns?: string[];
}

/** 写文件类工具：模式匹配走路径 glob。 */
export const FILE_WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

/** 内置危险命令基线默认集（bash 子串匹配，大小写不敏感；可被 config 增删）。 */
export const DEFAULT_DANGER_PATTERNS: readonly string[] = [
    "rm -rf",
    "rm -fr",
    "sudo",
    "mkfs",
    "dd if=",
    "> /dev/",
    "shutdown",
    "reboot",
    "crontab",
    "| sh",
    "| bash",
    "|sh",
];

/** per-agent 权限上下文（C-004：随 agent 生命周期，会话内缓存不跨 session）。 */
export interface PermissionContext {
    mode: PermissionMode;
    /** 合并后的用户规则：全局在前、项目在后（后匹配覆盖）。运行中"永久允许"追加到此数组（内存态，web 端另行落盘）。 */
    rules: PermissionRule[];
    dangerPatterns: readonly string[];
    /** 只读工具名集合（AR-7：从 Tool.meta.readOnly 推导；MCP/无 meta 工具不在其中=保守 ask） */
    readOnlyTools: ReadonlySet<string>;
    /** 会话内"允许一次"缓存：key = tool + "|" + ruleKey（D-007）。 */
    allowOnce: Set<string>;
}

// ── 匹配器 ──

const ESCAPE_RE = /[.+^${}()|[\]\\]/g;

/** bash 命令模式匹配：`*` 匹配任意字符（含空格），整体锚定。"npm *" → "npm run build" ✓ */
export function matchCommandPattern(pattern: string, command: string): boolean {
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === "*") re += "[\\s\\S]*";
        else re += ch.replace(ESCAPE_RE, "\\$&");
    }
    return new RegExp(`^${re}$`).test(command);
}

/** 编译单段路径 glob：`**` 跨段、`*` 单段内、`?` 单字符，整体锚定。 */
function compilePathGlob(pattern: string): RegExp {
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === "*") {
            if (pattern[i + 1] === "*") {
                re += ".*";
                i++;
            } else {
                re += "[^/]*";
            }
        } else if (ch === "?") {
            re += "[^/]";
        } else {
            re += ch.replace(ESCAPE_RE, "\\$&");
        }
    }
    return new RegExp(`^${re}$`);
}

/** 路径 glob 匹配：模式为工作区相对形式，也命中完整路径中任一段边界起始的后缀
 *  （"src/**" 命中 "/proj/src/a.ts"）。 */
export function matchPathPattern(pattern: string, filePath: string): boolean {
    const regex = compilePathGlob(pattern);
    if (regex.test(filePath)) return true;
    // 按段剥前缀重试（段边界起始的后缀）
    let rest = filePath;
    while (rest.includes("/")) {
        rest = rest.slice(rest.indexOf("/") + 1);
        if (rest && regex.test(rest)) return true;
    }
    return false;
}

/** 规则是否命中该工具调用。 */
function ruleMatches(rule: PermissionRule, tool: string, argValue?: string): boolean {
    if (rule.tool !== tool) return false;
    if (rule.pattern === undefined) return true; // 仅工具名级
    if (argValue === undefined) return false; // 带模式的规则要求有参数可匹配
    const matcher = FILE_WRITE_TOOLS.has(tool)
        ? matchPathPattern
        : matchCommandPattern;
    return matcher(rule.pattern, argValue);
}

/** 取参与匹配的工具参数：bash→command，write/edit→filePath，其余无。 */
function matchableArg(tool: string, args: Record<string, unknown>): string | undefined {
    if (tool === "bash") {
        const c = args.command;
        return typeof c === "string" ? c : undefined;
    }
    if (FILE_WRITE_TOOLS.has(tool)) {
        const p = args.filePath;
        return typeof p === "string" ? p : undefined;
    }
    return undefined;
}

// ── 判定引擎（纯函数，B-002 顺序） ──

export interface EvaluateInput {
    mode: PermissionMode;
    /** 合并后的用户规则：全局在前、项目在后（后匹配覆盖，D-003） */
    rules: PermissionRule[];
    dangerPatterns: readonly string[];
    /** 只读工具名集合（AR-7：由 Tool.meta.readOnly 推导，缺省保守=不在集合内） */
    readOnlyTools: ReadonlySet<string>;
    tool: string;
    args: Record<string, unknown>;
}

export function evaluatePermission(input: EvaluateInput): PermissionVerdict {
    const { mode, rules, dangerPatterns, tool, args } = input;
    const argValue = matchableArg(tool, args);

    // ① 用户显式规则：组合序列取最后匹配（项目级在数组尾部 = 后匹配覆盖全局）
    for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (ruleMatches(rule, tool, argValue)) {
            const ruleKey = rule.pattern ?? rule.tool;
            return { action: rule.action, source: "rule", ruleKey };
        }
    }

    // ② 危险命令基线：仅 bash，命中即 ask（信任模式不可越过，C-001）
    if (tool === "bash" && typeof argValue === "string") {
        const lower = argValue.toLowerCase();
        if (dangerPatterns.some((p) => lower.includes(p.toLowerCase()))) {
            // 缓存键取首 token + " *"：裁决粒度与展示一致（D-007）
            const firstToken = argValue.trim().split(/\s+/)[0] ?? "bash";
            return { action: "ask", source: "baseline", ruleKey: `${firstToken} *` };
        }
    }

    // ③ 模式默认策略（只读判定来自工具元数据，AR-7）
    if (mode === "trusted") {
        return { action: "allow", source: "mode", ruleKey: tool };
    }
    if (input.readOnlyTools.has(tool)) {
        return { action: "allow", source: "mode", ruleKey: tool };
    }
    if (mode === "accept_edits" && FILE_WRITE_TOOLS.has(tool)) {
        return { action: "allow", source: "mode", ruleKey: tool };
    }
    // standard：bash/write/edit/MCP（未知工具名）一律 ask
    return {
        action: "ask",
        source: "mode",
        ruleKey: tool === "bash" && typeof argValue === "string"
            ? `${argValue.trim().split(/\s+/)[0] ?? "bash"} *`
            : tool,
    };
}

// ── 项目级规则装载（fail-safe，C-003） ──

/** 项目级权限文件：<rootPath>/.anycode/permissions.yaml（A-004，沿 mcp.yaml 先例）。 */
export function projectPermissionsFile(workspace: Workspace): string {
    return path.join(workspaceConfigDir(workspace), "permissions.yaml");
}

/** 读项目级规则；缺失返回 []，损坏抛错由调用方决定 fail-safe 行为（测试需要区分）。 */
export function loadProjectPermissions(workspace: Workspace): PermissionRule[] {
    const file = projectPermissionsFile(workspace);
    if (!fs.existsSync(file)) return [];
    const parsed = yaml.load(fs.readFileSync(file, "utf-8")) as
        | { rules?: PermissionRule[] }
        | null;
    const rules = parsed?.rules;
    if (!Array.isArray(rules)) return [];
    return rules.filter(
        (r) =>
            r &&
            typeof r.tool === "string" &&
            (r.action === "allow" || r.action === "ask" || r.action === "deny"),
    );
}

/** 写项目级规则（永久允许/拒绝落盘用）。 */
export function saveProjectPermissions(
    workspace: Workspace,
    rules: PermissionRule[]
): void {
    const file = projectPermissionsFile(workspace);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
        file,
        yaml.dump({ rules }, { lineWidth: 120 }),
        "utf-8"
    );
}
