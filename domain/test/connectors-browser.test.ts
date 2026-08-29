import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// browser 连接器（CDP v2）：真 headless chromium --remote-debugging-port + SDK 真连。
// chromium 不存在时整组 skip（CI/无 playwright 缓存环境）。
const here = dirname(fileURLToPath(import.meta.url));
const SERVERS = join(here, "..", "src", "builtin-servers");
const home = process.env.HOME ?? "";
const chromeBin = [
    `${home}/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome`,
    `${home}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
].find(existsSync);

const port = 9400 + Math.floor(Math.random() * 300);
let chrome: ChildProcess | null = null;
let pageWs = "";

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
    for (let i = 0; i < 40 && !pageWs; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`);
            const list = (await res.json()) as Array<{
                type: string;
                webSocketDebuggerUrl?: string;
            }>;
            const page = list.find((t) => t.type === "page");
            if (page?.webSocketDebuggerUrl) pageWs = page.webSocketDebuggerUrl;
        } catch {
            // 端点未就绪，重试
        }
        if (!pageWs) await new Promise((r) => setTimeout(r, 250));
    }
    if (!pageWs) throw new Error("chromium CDP 端点未就绪");
});

afterAll(() => {
    chrome?.kill("SIGKILL");
});

async function call(browserTool: string, args: object, extra: object = {}) {
    const client = new Client({ name: "t", version: "0" });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(SERVERS, "browser-server.mjs")],
        env: { ...process.env, ABILITY_CONFIG: JSON.stringify({ cdpUrl: pageWs, ...extra }) },
    });
    await client.connect(transport);
    try {
        const res = await client.callTool({ name: browserTool, arguments: args });
        const content = (res as { content?: Array<{ type?: string; text?: string }> })?.content;
        return (content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    } finally {
        await client.close().catch(() => {});
    }
}

describe("browser 连接器（CDP v2，真 chromium）", () => {
    it.skipIf(!chromeBin)(
        "browser_navigate → browser_content 真导航 example.com 并读到正文",
        async () => {
            const nav = await call("browser_navigate", { url: "https://example.com" });
            expect(nav).toMatch(/load 完成|Example Domain/);
            const content = await call("browser_content", {});
            expect(content).toContain("Example Domain");
        },
        40000
    );

    it.skipIf(!chromeBin)("browser_eval 执行 JS 取 document.title", async () => {
        const r = await call("browser_eval", { js: "document.title" });
        expect(r).toContain("Example");
    }, 20000);

    it("无 cdpUrl → 明确错误提示（不崩）", async () => {
        const out = await call("browser_content", {}, { cdpUrl: "" });
        expect(out).toMatch(/cdpUrl/);
    }, 15000);
});