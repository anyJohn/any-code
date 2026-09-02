import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

// 配置抹除回归：POST/PATCH /api/config 不得丢掉表单之外的段（gitBashPath/abilities）。
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
                "abilities:",
                "  web-fetch:",
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

    it("POST 保存表单后 gitBashPath / abilities 保留", async () => {
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
        expect(cfg).toContain("web-fetch:");
        expect(cfg).toContain("enabled: true");
    });

    it("PATCH 切默认模型后 gitBashPath / abilities 保留", async () => {
        const res = await app.request("/api/config", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ modelId: "m1" }),
        });
        expect(res.status).toBe(200);
        const cfg = readCfg();
        expect(cfg).toContain("gitBashPath: C:\\Git\\bin\\bash.exe");
        expect(cfg).toContain("web-fetch:");
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
