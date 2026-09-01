import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    evaluatePermission,
    matchCommandPattern,
    matchPathPattern,
    DEFAULT_DANGER_PATTERNS,
    loadProjectPermissions,
    saveProjectPermissions,
    projectPermissionsFile,
    type PermissionRule,
    type PermissionMode,
} from "../src/permissions";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "../src/workspace";

const RULE = (tool: string, pattern: string | undefined, action: PermissionRule["action"]): PermissionRule => ({
    tool,
    pattern,
    action,
});

const evalBasic = (
    mode: PermissionMode,
    rules: PermissionRule[],
    tool: string,
    args: Record<string, unknown>
) =>
    evaluatePermission({
        mode,
        rules,
        dangerPatterns: DEFAULT_DANGER_PATTERNS,
        tool,
        args,
    });

describe("匹配器", () => {
    it("命令模式：* 匹配任意字符（含空格），整体锚定", () => {
        expect(matchCommandPattern("npm *", "npm run build")).toBe(true);
        expect(matchCommandPattern("npm *", "npm")).toBe(false);
        expect(matchCommandPattern("*", "anything at all")).toBe(true);
        expect(matchCommandPattern("git status", "git status")).toBe(true);
        expect(matchCommandPattern("git status", "git status -s")).toBe(false);
    });

    it("路径 glob：** 跨段、* 单段、? 单字符", () => {
        expect(matchPathPattern("src/**", "src/a.ts")).toBe(true);
        expect(matchPathPattern("src/**", "src/a/b/c.ts")).toBe(true);
        expect(matchPathPattern("src/*.ts", "src/a.ts")).toBe(true);
        expect(matchPathPattern("src/*.ts", "src/a/b.ts")).toBe(false);
        expect(matchPathPattern("docs/**", "src/b.md")).toBe(false);
        expect(matchPathPattern("a?c", "abc")).toBe(true);
    });
});

describe("判定顺序（B-002）", () => {
    it("AC-002：规则 allow Bash(npm *) → npm 系命令直通，ruleKey 为匹配模式", () => {
        const v = evalBasic("standard", [RULE("bash", "npm *", "allow")], "bash", {
            command: "npm install",
        });
        expect(v).toEqual({ action: "allow", source: "rule", ruleKey: "npm *" });
    });

    it("AC-003：项目级 allow 覆盖全局 deny（后匹配生效）", () => {
        const rules = [
            RULE("bash", "*", "deny"), // 全局
            RULE("bash", "npm *", "allow"), // 项目级（数组尾部）
        ];
        const allow = evalBasic("standard", rules, "bash", { command: "npm run build" });
        expect(allow.action).toBe("allow");
        const deny = evalBasic("standard", rules, "bash", { command: "ls -la" });
        expect(deny.action).toBe("deny");
    });

    it("AC-004：信任模式下危险基线仍 ask；未命中直通", () => {
        const hit = evalBasic("trusted", [], "bash", { command: "rm -rf /tmp/x" });
        expect(hit.action).toBe("ask");
        expect(hit.source).toBe("baseline");
        const pass = evalBasic("trusted", [], "bash", { command: "ls -la" });
        expect(pass.action).toBe("allow");
    });

    it("AC-008：Write 路径规则命中 src/** 直通，docs/** 落模式默认", () => {
        const rules = [RULE("write", "src/**", "allow")];
        const src = evalBasic("standard", rules, "write", { filePath: "/proj/src/a.ts" });
        expect(src.action).toBe("allow");
        const docs = evalBasic("standard", rules, "write", { filePath: "/proj/docs/b.md" });
        expect(docs.action).toBe("ask");
        expect(docs.source).toBe("mode");
    });

    it("无用户规则命中 → 危险基线先于模式默认（标准模式 rm -rf ask 而非由 bash 默认 ask，来源可辨）", () => {
        const v = evalBasic("standard", [], "bash", { command: "sudo apt install x" });
        expect(v.source).toBe("baseline");
        expect(v.ruleKey).toBe("sudo *");
    });

    it("用户显式规则可覆盖危险基线（知情放行）", () => {
        const v = evalBasic("trusted", [RULE("bash", "sudo *", "allow")], "bash", {
            command: "sudo apt install x",
        });
        expect(v.action).toBe("allow");
        expect(v.source).toBe("rule");
    });
});

describe("模式默认策略（B-004/B-009）", () => {
    it("标准：bash/write/edit/MCP ask，只读 allow", () => {
        expect(evalBasic("standard", [], "bash", { command: "ls" }).action).toBe("ask");
        expect(evalBasic("standard", [], "write", { filePath: "/x/a.ts" }).action).toBe("ask");
        expect(evalBasic("standard", [], "edit", { filePath: "/x/a.ts" }).action).toBe("ask");
        expect(evalBasic("standard", [], "mcp_x", {}).action).toBe("ask");
        expect(evalBasic("standard", [], "grep", {}).action).toBe("allow");
        expect(evalBasic("standard", [], "read", {}).action).toBe("allow");
    });

    it("编辑放行：write/edit allow，bash/MCP 仍 ask", () => {
        expect(evalBasic("accept_edits", [], "write", { filePath: "/x/a.ts" }).action).toBe("allow");
        expect(evalBasic("accept_edits", [], "edit", { filePath: "/x/a.ts" }).action).toBe("allow");
        expect(evalBasic("accept_edits", [], "bash", { command: "ls" }).action).toBe("ask");
        expect(evalBasic("accept_edits", [], "mcp_x", {}).action).toBe("ask");
    });

    it("信任：全 allow（基线除外）", () => {
        expect(evalBasic("trusted", [], "mcp_x", {}).action).toBe("allow");
        expect(evalBasic("trusted", [], "bash", { command: "echo hi" }).action).toBe("allow");
    });

    it("deny 规则永不放行（I-002）", () => {
        const v = evalBasic("trusted", [RULE("mcp_x", undefined, "deny")], "mcp_x", {});
        expect(v.action).toBe("deny");
    });

    it("bash 模式默认的缓存键为首 token + ' *'（D-007）", () => {
        const v = evalBasic("standard", [], "bash", { command: "ls -la /tmp" });
        expect(v.ruleKey).toBe("ls *");
    });
});

describe("项目级规则装载（fail-safe，C-003）", () => {
    const origHome = process.env.HOME;
    let home: string;
    let ws: Workspace;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), "anycode-perm-"));
        process.env.HOME = home;
        ws = { rootPath: join(home, "proj"), ignoredPatterns: [] };
    });

    afterEach(() => {
        process.env.HOME = origHome;
        rmSync(home, { recursive: true, force: true });
    });

    it("无文件 → 空规则", () => {
        expect(loadProjectPermissions(ws)).toEqual([]);
    });

    it("读写往返", () => {
        const rules = [RULE("bash", "npm *", "allow"), RULE("mcp_x", undefined, "deny")];
        saveProjectPermissions(ws, rules);
        expect(loadProjectPermissions(ws)).toEqual(rules);
        expect(projectPermissionsFile(ws)).toContain("permissions.yaml");
    });

    it("损坏文件 → 抛错（调用方 fail-safe 兜底）", () => {
        mkdirSync(join(home, "proj", ".anycode"), { recursive: true });
        writeFileSync(projectPermissionsFile(ws), "{ broken yaml: [", "utf-8");
        expect(() => loadProjectPermissions(ws)).toThrow();
    });
});
