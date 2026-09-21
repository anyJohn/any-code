import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { browserUseTool } from "../src/tools/functions/browserUseTool";
import type { ToolContext } from "../src/context";

// browser_* 原生工具（用户决策 2026-09-03）：真 headless chromium --remote-debugging-port 直连。
// chromium 不存在时整组 skip（CI/无 playwright 缓存环境）。
// 注意：CDP 客户端为模块级单例——"无 cdpUrl"用例必须先于建连用例（文件内顺序执行）。
const chromeBin = [
    `${process.env.HOME ?? ""}/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome`,
    `${process.env.HOME ?? ""}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
].find(existsSync);

const port = 9700 + Math.floor(Math.random() * 200);
let chrome: ChildProcess | null = null;
let ready = false;

// HOME 隔离：toolConfig 现读 config.yaml（方案 A）——不隔离会读到真实
// browser_use 配置，压过测试注入的 cdpUrl。最小 config（无 tools 段）→ 回退 ctx 值。
let home = "";
const ORIG_HOME = process.env.HOME;

const ctx = (cdpUrl: string): ToolContext =>
    ({
        workspace: {} as never,
        eventStream: { submit: () => {} },
        signal: new AbortController().signal,
        toolsConfig: { browser_use: { cdpUrl } },
    }) as ToolContext;

beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "anycode-bt-"));
    process.env.HOME = home;
    mkdirSync(join(home, ".anycode"), { recursive: true });
    writeFileSync(
        join(home, ".anycode", "config.yaml"),
        [
            "providers:",
            "  openai:",
            "    apiKey: sk-test",
            "    models: [{ id: m }]",
            "    defaultModel: m",
            "default: openai",
        ].join("\n"),
        "utf-8"
    );
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
    rmSync(home, { recursive: true, force: true });
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
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

// bugfix 2026-09-20：原先只检查 contexts()[0] 是否存在，但"有 context 却零 page"
// （窗口全关只剩后台进程 / 刚启动没开页）会取到 undefined 并误报 "no open window"。
describe("browser_use 零页面自愈与文案对齐（bugfix）", () => {
    it("端口无服务 → 提示里的端口取自配置，不是硬编码 9222", async () => {
        // 用一个确定没开的端口
        const dead = "http://127.0.0.1:19999";
        const out = await browserUseTool.handler({ action: "content" }, ctx(dead));
        const s = String(out);
        expect(s).toMatch(/Browser is not running/);
        expect(s).toContain("--remote-debugging-port=19999"); // 对齐实际配置
        expect(s).not.toContain("9222"); // 旧的硬编码不得出现
    });

    it.skipIf(!chromeBin)(
        "关掉所有页面后仍可用（自愈：自动开空白页，不再误报 no open window）",
        async () => {
            const cdp = `http://127.0.0.1:${port}`;
            // 关掉该浏览器下所有 page target，造出"有 context 零 page"状态
            const list = (await (await fetch(`${cdp}/json/list`)).json()) as Array<{
                id: string;
                type: string;
            }>;
            for (const t of list.filter((x) => x.type === "page")) {
                await fetch(`${cdp}/json/close/${t.id}`);
            }
            await new Promise((r) => setTimeout(r, 500));
            const after = (await (await fetch(`${cdp}/json/list`)).json()) as Array<{
                type: string;
            }>;
            expect(after.filter((t) => t.type === "page")).toHaveLength(0); // 前置条件成立

            // 零 page 状态下调用走 activePage 的 action：应自愈成功，而不是报 "no open window"
            // （tabs 走 contextOf，测不到 activePage 的 undefined 路径，故用 eval）
            const r = await browserUseTool.handler({ action: "eval", js: "1+1" }, ctx(cdp));
            const s = String(r);
            expect(s).not.toMatch(/No usable page|no open window/);
            expect(s).toContain("2"); // 真的执行成功（自愈后拿到了页面）
        },
        30000
    );
});
