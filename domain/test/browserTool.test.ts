import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { browserUseTool } from "../src/tools/functions/browserUseTool";
import type { ToolContext } from "../src/context";

// browser_* 原生工具（用户决策 2026-09-03）：真 headless chromium --remote-debugging-port 直连。
// chromium 不存在时整组 skip（CI/无 playwright 缓存环境）。
// 注意：CDP 客户端为模块级单例——"无 cdpUrl"用例必须先于建连用例（文件内顺序执行）。
const home = process.env.HOME ?? "";
const chromeBin = [
    `${home}/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome`,
    `${home}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
].find(existsSync);

const port = 9700 + Math.floor(Math.random() * 200);
let chrome: ChildProcess | null = null;
let ready = false;

const ctx = (cdpUrl: string): ToolContext =>
    ({
        workspace: {} as never,
        eventStream: { submit: () => {} },
        signal: new AbortController().signal,
        toolsConfig: { browser_use: { cdpUrl } },
    }) as ToolContext;

beforeAll(async () => {
    if (!chromeBin) return;
    chrome = spawn(
        chromeBin,
        [
            "--headless=new",
            `--remote-debugging-port=${port}`,
            "--user-data-dir=" + mkdtempSync(join(tmpdir(), "anycode-cdp-")),
            "about:blank",
        ],
        { stdio: "ignore" }
    );
    for (let i = 0; i < 40 && !ready; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`);
            if (res.ok) ready = true;
        } catch {
            // 端点未就绪，重试
        }
        if (!ready) await new Promise((r) => setTimeout(r, 250));
    }
    if (!ready) throw new Error("chromium CDP 端点未就绪");
});

afterAll(() => {
    chrome?.kill("SIGKILL");
});

describe("browser_* 原生工具（CDP，真 chromium）", () => {
    it("无 cdpUrl → 明确错误提示（不崩）", async () => {
        if (!chromeBin) return;
        const out = await browserUseTool.handler({ action: "content" }, ctx(""));
        expect(String(out)).toMatch(/cdpUrl/);
    });

    it.skipIf(!chromeBin)(
        "action=navigate → content 真导航 example.com 并读到正文",
        async () => {
            const nav = await browserUseTool.handler(
                { action: "navigate", url: "https://example.com" },
                ctx(`http://127.0.0.1:${port}`)
            );
            expect(String(nav)).toMatch(/load 完成|Example Domain/);
            const c = await browserUseTool.handler(
                { action: "content" },
                ctx(`http://127.0.0.1:${port}`)
            );
            expect(String(c)).toContain("Example Domain");
        },
        40000
    );

    it.skipIf(!chromeBin)(
        "action=eval 执行 JS 取 document.title",
        async () => {
            const r = await browserUseTool.handler(
                { action: "eval", js: "document.title" },
                ctx(`http://127.0.0.1:${port}`)
            );
            expect(String(r)).toContain("Example");
        },
        20000
    );

    it("action 非法 → 错误文案（不崩）", async () => {
        const r = await browserUseTool.handler({ action: "nope" }, ctx(""));
        expect(String(r)).toContain("action");
    });
});
