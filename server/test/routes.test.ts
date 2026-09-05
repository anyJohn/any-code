import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { SessionService } from "@any-code/domain";
import { createApp } from "../src/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AC-008（server 可作为库 import + app.request 跑路由）+ SPEC-028 AC-002 子集。
// 这些 GET/400 都只读 domain 的 ~/.anycode（config/workspaces/session 查找），无副作用。

describe("@any-code/server routes", () => {
    const app = createApp(); // 无 staticDir → API only

    it("createApp 返回 Hono app（AC-008：可作为库 import，桌面端可 spawn）", () => {
        expect(app).toBeDefined();
        expect(typeof app.request).toBe("function");
    });

    it("GET /api/config → 200 + providers（domain Config 集成）", async () => {
        const res = await app.request("/api/config");
        expect(res.status).toBe(200);
        const json = (await res.json()) as { providers: unknown };
        expect(json).toHaveProperty("providers");
    });

    it("GET /api/workspaces → 200 + 数组", async () => {
        const res = await app.request("/api/workspaces");
        expect(res.status).toBe(200);
        expect(Array.isArray(await res.json())).toBe(true);
    });

    it("GET /api/sessions/none/history → 404（不存在的 session）", async () => {
        const res = await app.request("/api/sessions/none/history");
        expect(res.status).toBe(404);
    });

    it("POST /api/sessions 缺 workspacePath → 400（参数校验）", async () => {
        const res = await app.request("/api/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
        });
        expect(res.status).toBe(400);
    });

    it("GET /api/fs/browse?dir=/tmp → 200 + current", async () => {
        const res = await app.request("/api/fs/browse?dir=/tmp");
        expect(res.status).toBe(200);
        const json = (await res.json()) as { current: string; dirs: unknown[] };
        expect(json.current).toBe("/tmp");
        expect(Array.isArray(json.dirs)).toBe(true);
    });

    it("GET /api/search?q=zzznomatch → 200 + 空 sessions/workspaces", async () => {
        const res = await app.request("/api/search?q=zzznomatchxyz");
        expect(res.status).toBe(200);
        const json = (await res.json()) as { sessions: unknown[]; workspaces: unknown[] };
        expect(json.sessions).toEqual([]);
    });

    // ---- FR-30 / SPEC-033 新路由 ----

    it("GET /api/running → 200 + 数组（无运行中会话为空）", async () => {
        const res = await app.request("/api/running");
        expect(res.status).toBe(200);
        expect(Array.isArray(await res.json())).toBe(true);
    });

    it("POST /api/sessions/none/stop → 404（未运行）", async () => {
        const res = await app.request("/api/sessions/none/stop", { method: "POST" });
        expect(res.status).toBe(404);
    });

    it("GET /api/sessions/none/stream → 404（未运行，客户端回退 /history）", async () => {
        const res = await app.request("/api/sessions/none/stream?since=-1");
        expect(res.status).toBe(404);
    });
});

// 配置抹除回归：POST/PATCH /api/config 不得丢掉表单之外的段（gitBashPath/tools）。
// 用临时 HOME 隔离（globalConfigDir 每次 call 读 os.homedir() → HOME env），不动真实 ~/.anycode。
describe("POST/PATCH /api/config 保留非表单段", () => {
    const app = createApp();
    const origHome = process.env.HOME;
    let home: string;

    beforeAll(() => {
        home = mkdtempSync(join(tmpdir(), "anycode-cfg-"));
        process.env.HOME = home;
        mkdirSync(join(home, ".anycode"), { recursive: true });
        writeFileSync(
            join(home, ".anycode", "config.yaml"),
            [
                "providers:",
                "  openai:",
                "    apiKey: sk-test",
                "    models: [{ id: m1 }, { id: m2 }]",
                "    defaultModel: m1",
                "default: openai",
                "gitBashPath: C:\\Git\\bin\\bash.exe",
                "tools:",
                "  web_fetch:",
                "    enabled: true",
            ].join("\n"),
            "utf-8"
        );
    });

    afterAll(() => {
        process.env.HOME = origHome;
        rmSync(home, { recursive: true, force: true });
    });

    const readCfg = (): string =>
        readFileSync(join(home, ".anycode", "config.yaml"), "utf-8");

    it("POST 保存表单后 gitBashPath / tools 保留", async () => {
        const res = await app.request("/api/config", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                providers: {
                    openai: {
                        apiKey: "",
                        models: [{ id: "m1" }, { id: "m2" }],
                        defaultModel: "m2",
                        streaming: true,
                    },
                },
                default: "openai",
                mcp: {},
            }),
        });
        expect(res.status).toBe(200);
        const cfg = readCfg();
        expect(cfg).toContain("gitBashPath: C:\\Git\\bin\\bash.exe");
        expect(cfg).toContain("web_fetch:");
        expect(cfg).toContain("enabled: true");
    });

    it("PATCH 切默认模型后 gitBashPath / tools 保留", async () => {
        const res = await app.request("/api/config", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ modelId: "m1" }),
        });
        expect(res.status).toBe(200);
        const cfg = readCfg();
        expect(cfg).toContain("gitBashPath: C:\\Git\\bin\\bash.exe");
        expect(cfg).toContain("web_fetch:");
    });

    it("PATCH language → 写入 ui.language；maxConcurrentRuns 等其余段保留（FR-29）", async () => {
        const res = await app.request("/api/config", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ language: "en" }),
        });
        expect(res.status).toBe(200);
        const cfg = readCfg();
        expect(cfg).toContain("language: en");
        expect(cfg).toContain("gitBashPath: C:\\Git\\bin\\bash.exe");
        // GET 读回 ui 段
        const get = await app.request("/api/config");
        const json = (await get.json()) as { ui?: { language?: string } };
        expect(json.ui?.language).toBe("en");
        // 非法值 → 400
        const bad = await app.request("/api/config", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ language: "fr" }),
        });
        expect(bad.status).toBe(400);
    });
});


// 权限规则路由（SPEC-032）：全局走 config.yaml，项目级走 .anycode/permissions.yaml。
// 临时 HOME 隔离（同上）。
describe("POST /api/config/permissions/rule + 项目级 permissions 路由", () => {
    const app = createApp();
    const origHome = process.env.HOME;
    let home: string;

    beforeAll(() => {
        home = mkdtempSync(join(tmpdir(), "anycode-perm-"));
        process.env.HOME = home;
        mkdirSync(join(home, ".anycode"), { recursive: true });
        writeFileSync(
            join(home, ".anycode", "config.yaml"),
            [
                "providers:",
                "  openai:",
                "    apiKey: sk-test",
                "    models: [{ id: m1 }]",
                "    defaultModel: m1",
                "default: openai",
                "permissions:",
                "  mode: standard",
                "  rules: []",
            ].join("\n"),
            "utf-8"
        );
    });

    afterAll(() => {
        process.env.HOME = origHome;
        rmSync(home, { recursive: true, force: true });
    });

    it("全局规则 → 写入 config.yaml permissions.rules", async () => {
        const res = await app.request("/api/config/permissions/rule", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tool: "bash", pattern: "git *", action: "allow", scope: "global" }),
        });
        expect(res.status).toBe(200);
        const cfg = readFileSync(join(home, ".anycode", "config.yaml"), "utf-8");
        expect(cfg).toContain("tool: bash");
        expect(cfg).toContain("pattern: git *");
    });

    it("项目级规则 → 写入 <ws>/.anycode/permissions.yaml，GET 可读回", async () => {
        const ws = join(home, "proj");
        mkdirSync(ws, { recursive: true });
        await app.request("/api/workspaces", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: ws }),
        });
        const res = await app.request("/api/config/permissions/rule", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tool: "write", pattern: "src/**", action: "allow", scope: "project", workspacePath: ws }),
        });
        expect(res.status).toBe(200);
        const PK = (
            (await (await app.request("/api/workspaces")).json()) as Array<{ rootPath: string; projectKey: string }>
        ).find((w) => w.rootPath === ws)!.projectKey;

        const got = (await (await app.request(`/api/workspaces/${PK}/permissions`)).json()) as {
            rules: Array<{ tool: string }>;
        };
        expect(got.rules).toHaveLength(1);
        expect(got.rules[0].tool).toBe("write");

        // PUT 整表替换
        const put = await app.request(`/api/workspaces/${PK}/permissions`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ rules: [{ tool: "bash", action: "deny" }] }),
        });
        expect(put.status).toBe(200);
        const got2 = (await (await app.request(`/api/workspaces/${PK}/permissions`)).json()) as {
            rules: Array<{ tool: string; action: string }>;
        };
        expect(got2.rules).toEqual([{ tool: "bash", action: "deny" }]);
    });
});

// SPEC-036 B-007/008/009：文件 tab + 快照 diff 路由
describe("文件 tab / 快照 diff 路由（SPEC-036）", () => {
    const app = createApp();
    let PK = "";

    beforeAll(async () => {
        const os = await import("node:os");
        const fs = await import("node:fs");
        const path = await import("node:path");
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-files-"));
        fs.writeFileSync(path.join(ws, "hello.ts"), "const a = 1;\n");
        fs.writeFileSync(path.join(ws, "big.bin"), Buffer.from([0x41, 0x00, 0x42]));
        fs.writeFileSync(path.join(ws, "huge.txt"), "x".repeat(1024 * 1024 + 1));
        fs.mkdirSync(path.join(ws, "sub"));
        fs.writeFileSync(path.join(ws, "sub", "n.md"), "# hi\n");
        await app.request("/api/workspaces", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: ws }),
        });
        const list = (await (
            await app.request("/api/workspaces")
        ).json()) as Array<{ rootPath: string; projectKey: string }>;
        PK = list.find(
            (w) => w.rootPath === ws
        )!.projectKey;
    });

    it("GET /files?all=1 → 全量列表（含子目录，不含未触发隐藏文件）", async () => {
        const res = await app.request(`/api/workspaces/${PK}/files?all=1`);
        expect(res.status).toBe(200);
        const files = (await res.json()) as Array<{ path: string }>;
        const paths = files.map((f) => f.path);
        expect(paths).toContain("hello.ts");
        expect(paths).toContain("sub/n.md");
    });

    it("GET /file?path= → 内容；逃逸路径 400；二进制 400；超 1MB 400；缺失 404", async () => {
        const ok = await app.request(
            `/api/workspaces/${PK}/file?path=${encodeURIComponent("hello.ts")}`
        );
        expect(ok.status).toBe(200);
        expect(((await ok.json()) as { content: string }).content).toBe("const a = 1;\n");

        const esc = await app.request(
            `/api/workspaces/${PK}/file?path=${encodeURIComponent("../../etc/passwd")}`
        );
        expect(esc.status).toBe(400);

        const bin = await app.request(
            `/api/workspaces/${PK}/file?path=${encodeURIComponent("big.bin")}`
        );
        expect(bin.status).toBe(400);
        expect(((await bin.json()) as { statusMessage: string }).statusMessage).toBe("binary file");

        const huge = await app.request(
            `/api/workspaces/${PK}/file?path=${encodeURIComponent("huge.txt")}`
        );
        expect(huge.status).toBe(400);
        expect(((await huge.json()) as { statusMessage: string }).statusMessage).toContain("1MB");

        const missing = await app.request(
            `/api/workspaces/${PK}/file?path=${encodeURIComponent("nope.txt")}`
        );
        expect(missing.status).toBe(404);
    });

    it("GET /snapshots/:id/diff → 非法 id 400；不存在快照 400", async () => {
        const bad = await app.request(
            `/api/workspaces/${PK}/snapshots/xx/diff`
        );
        expect(bad.status).toBe(400);
        const missing = await app.request(
            `/api/workspaces/${PK}/snapshots/deadbeef/diff`
        );
        expect(missing.status).toBe(400);
        expect(((await missing.json()) as { statusMessage: string }).statusMessage).toContain("不存在");
    });
});

// SPEC-036 B-013：会话截断路由（编辑重发）

describe("POST /api/sessions/:sessionId/truncate（SPEC-036 B-013）", () => {
    const app = createApp();
    let home: string;
    let sessionId = "";
    const origHome = process.env.HOME;

    beforeAll(async () => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-truncroute-"));
        process.env.HOME = home;
        const service = new SessionService();
        const s = await service.create("p-trunc", "t");
        sessionId = s.id;
        const key = { projectKey: "p-trunc", sessionId };
        await service.appendMessage(key, { role: "user", content: "u1" });
        await service.appendMessage(key, { role: "assistant", content: "a1" });
        await service.appendMessage(key, { role: "user", content: "u2" });
        await service.appendMessage(key, { role: "assistant", content: "a2" });
    });

    afterAll(() => {
        process.env.HOME = origHome;
        fs.rmSync(home, { recursive: true, force: true });
    });

    it("keep=1 → u2/a2 删除；非法参数 400；不存在会话 404", async () => {
        const res = await app.request(`/api/sessions/${sessionId}/truncate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ keepUserMessages: 1 }),
        });
        expect(res.status).toBe(200);
        const hist = (await (
            await app.request(`/api/sessions/${sessionId}/history`)
        ).json()) as { messages: Array<{ content: string }> };
        expect(hist.messages.map((m) => m.content)).toEqual(["u1", "a1"]);

        const bad = await app.request(`/api/sessions/${sessionId}/truncate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
        });
        expect(bad.status).toBe(400);

        const missing = await app.request(`/api/sessions/none/truncate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ keepUserMessages: 0 }),
        });
        expect(missing.status).toBe(404);
    });
});
