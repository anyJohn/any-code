import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadWorkspaceExtensions, runBeforeToolHook } from "../src/extensions";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AR-16：项目扩展（自定义工具 .anycode/tools/*.mjs + hooks.mjs）
describe("loadWorkspaceExtensions（AR-16）", () => {
    let home: string;
    let ws: string;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), "anycode-ext-"));
        process.env.HOME = home;
        ws = join(home, "proj");
        mkdirSync(join(ws, ".anycode", "tools"), { recursive: true });
        // Workspace 对象（rootPath 必填，workspaceConfigDir 用它拼 .anycode 路径）
    });

    afterEach(() => {
        process.env.HOME = home;
        rmSync(home, { recursive: true, force: true });
    });

    it("加载 .mjs 自定义工具（schema/meta/handler）", async () => {
        writeFileSync(
            join(ws, ".anycode", "tools", "hello.mjs"),
            `export default {
                name: "hello",
                description: "say hello",
                parameters: { type: "object", properties: { who: { type: "string" } } },
                readOnly: true,
                concurrencySafe: true,
                execute: (args) => \`hello \${args.who ?? "world"}\`,
            };`,
            "utf-8"
        );
        const ext = await loadWorkspaceExtensions({ rootPath: ws, ignoredPatterns: [] }, new Set(["read"]));
        expect(ext.warnings).toEqual([]);
        expect(ext.tools).toHaveLength(1);
        expect(ext.tools[0].schema.function.name).toBe("hello");
        expect(ext.tools[0].meta).toEqual({ readOnly: true, concurrencySafe: true });
        const out = await ext.tools[0].handler({ who: "anycode" }, {} as never);
        expect(out).toEqual({ content: "hello anycode" });
    });

    it("与内置工具重名 → 跳过 + 告警", async () => {
        writeFileSync(
            join(ws, ".anycode", "tools", "clash.mjs"),
            `export default { name: "read", execute: () => "x" };`,
            "utf-8"
        );
        const ext = await loadWorkspaceExtensions({ rootPath: ws, ignoredPatterns: [] }, new Set(["read"]));
        expect(ext.tools).toHaveLength(0);
        expect(ext.warnings[0]).toContain("冲突");
    });

    it("缺 execute / 缺 name → 跳过 + 告警；坏文件不阻断", async () => {
        writeFileSync(
            join(ws, ".anycode", "tools", "noexec.mjs"),
            `export default { name: "noexec" };`,
            "utf-8"
        );
        writeFileSync(join(ws, ".anycode", "tools", "broken.mjs"), "throw new Error('boom');", "utf-8");
        const ext = await loadWorkspaceExtensions({ rootPath: ws, ignoredPatterns: [] }, new Set());
        expect(ext.tools).toHaveLength(0);
        expect(ext.warnings.length).toBe(2);
    });

    it("hooks.mjs：beforeToolCall deny + afterToolCall 调用", async () => {
        writeFileSync(
            join(ws, ".anycode", "hooks.mjs"),
            `export const beforeToolCall = (tool, args) =>
                tool === "bash" && args.command?.includes("rm") ? { deny: "禁止 rm" } : undefined;
            export const afterToolCall = (tool) => { globalThis.__hookAfter = tool; };`,
            "utf-8"
        );
        const ext = await loadWorkspaceExtensions({ rootPath: ws, ignoredPatterns: [] }, new Set());
        expect(ext.hooks.beforeToolCall).toBeTruthy();
        const deny = await runBeforeToolHook(ext.hooks, "bash", { command: "rm -rf /" });
        expect(deny).toBe("禁止 rm");
        const pass = await runBeforeToolHook(ext.hooks, "bash", { command: "ls" });
        expect(pass).toBeNull();
    });

    it("无扩展目录 → 空结果无告警", async () => {
        const ext = await loadWorkspaceExtensions({ rootPath: ws, ignoredPatterns: [] }, new Set());
        expect(ext.tools).toEqual([]);
        expect(ext.hooks).toEqual({});
        expect(ext.warnings).toEqual([]);
    });
});
