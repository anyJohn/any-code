import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSnapshotService, parseSnapshotMessage } from "../src/snapshot";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AR-4：shadow-git 快照/回滚往返（本机 git 可用；CI 无 git 时跳过）
const gitOn = (() => {
    try {
        return require("node:child_process").spawnSync("git", ["--version"]).status === 0;
    } catch {
        return false;
    }
})();

describe("createSnapshotService（AR-4）", () => {
    const origHome = process.env.HOME;
    let home: string;
    let ws: string;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), "anycode-snap-"));
        process.env.HOME = home;
        ws = join(home, "proj");
        mkdirSync(ws, { recursive: true });
    });

    afterEach(() => {
        process.env.HOME = origHome;
        rmSync(home, { recursive: true, force: true });
    });

    it.skipIf(!gitOn)("快照/列表/回滚往返：修改文件后可恢复到快照时点", async () => {
        writeFileSync(join(ws, "a.txt"), "v1");
        const svc = createSnapshotService(ws);
        expect(svc.available()).toBe(true);

        const s1 = await svc.snapshot("write a.txt v1");
        expect(s1).not.toBeNull();
        expect(s1!.id).toMatch(/^[0-9a-f]{7,40}$/);

        // 修改 + 新增
        writeFileSync(join(ws, "a.txt"), "v2");
        writeFileSync(join(ws, "b.txt"), "new file");
        const s2 = await svc.snapshot("write a.txt v2 + b.txt");
        expect(s2).not.toBeNull();
        expect(s2!.id).not.toBe(s1!.id);

        // 列表（新→旧）
        const list = await svc.list();
        expect(list.length).toBeGreaterThanOrEqual(2);
        expect(list[0].id).toBe(s2!.id);

        // 回滚到 s1：a.txt 恢复 v1（b.txt 为 s1 之后新建且已跟踪于 s2——checkout s1 不会删除）
        await svc.rollbackTo(s1!.id);
        expect(readFileSync(join(ws, "a.txt"), "utf-8")).toBe("v1");
    });

    it.skipIf(!gitOn)("回滚不存在的 id → 抛错；非法 id → 抛错（注入防护）", async () => {
        const svc = createSnapshotService(ws);
        await svc.snapshot("init");
        await expect(svc.rollbackTo("deadbeefdeadbeef")).rejects.toThrow(/不存在/);
        await expect(svc.rollbackTo("../etc/passwd")).rejects.toThrow(/非法快照 id/);
    });

    it.skipIf(gitOn)("git 不可用 → available false，snapshot 返回 null", async () => {
        // 仅在无 git 环境执行（CI 兜底断言）
        const svc = createSnapshotService(ws);
        expect(svc.available()).toBe(false);
        await expect(svc.snapshot("x")).resolves.toBeNull();
    });
});

// SPEC-036 B-007：diffFrom——工作树相对快照的变更（变更 tab 数据源）
describe.skipIf(!gitOn)("createSnapshotService.diffFrom（SPEC-036 B-007）", () => {
    const origHome = process.env.HOME;
    let home: string;
    let ws: string;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), "anycode-snapdiff-"));
        process.env.HOME = home;
        ws = join(home, "proj");
        mkdirSync(ws, { recursive: true });
    });

    afterEach(() => {
        process.env.HOME = origHome;
        rmSync(home, { recursive: true, force: true });
    });

    it("快照后修改/新增文件 → name-status 与 patch 正确；单文件过滤生效", async () => {
        writeFileSync(join(ws, "a.txt"), "one\n");
        const svc = createSnapshotService(ws);
        const snap = await svc.snapshot("before");
        expect(snap).not.toBeNull();
        const id = snap!.id;

        writeFileSync(join(ws, "a.txt"), "one\ntwo\n");
        writeFileSync(join(ws, "b.txt"), "new\n");

        const all = await svc.diffFrom(id);
        const byStatus = new Map(all.files.map((f) => [f.path, f.status]));
        expect(byStatus.get("a.txt")).toBe("M");
        expect(byStatus.get("b.txt")).toBe("A");
        expect(all.patch).toContain("+two");
        expect(all.patch).toContain("+new");

        const single = await svc.diffFrom(id, "a.txt");
        expect(single.files).toHaveLength(1);
        expect(single.files[0].path).toBe("a.txt");
        expect(single.patch).not.toContain("b.txt");
    });

    it("非法 id / 不存在的快照 → 抛错", async () => {
        const svc = createSnapshotService(ws);
        await expect(svc.diffFrom("$(rm -rf /)")).rejects.toThrow("非法快照 id");
        await expect(svc.diffFrom("deadbeef")).rejects.toThrow("不存在");
    });
});

// SPEC-036 / 用户决策 2026-09-06：domain 存结构化事实（command + sessionId），不存展示 label
describe("snapshot 结构化存储（用户决策 2026-09-06）", () => {
    const origHome = process.env.HOME;
    it("snapshot(command, sessionId) → list() 返回结构化字段", async () => {
        const home = mkdtempSync(join(tmpdir(), "anycode-snapmeta-"));
        process.env.HOME = home;
        const ws = join(home, "proj");
        mkdirSync(ws, { recursive: true });
        writeFileSync(join(ws, "f.txt"), "x\n");
        try {
            const svc = createSnapshotService(ws);
            await svc.snapshot("write f.txt", "sess-1234");
            const list = await svc.list();
            expect(list).toHaveLength(1);
            expect(list[0].command).toBe("write f.txt");
            expect(list[0].sessionId).toBe("sess-1234");
            expect(typeof list[0].ts).toBe("number");
        } finally {
            process.env.HOME = origHome;
            rmSync(home, { recursive: true, force: true });
        }
    });

    it("parseSnapshotMessage：JSON 格式", () => {
        expect(parseSnapshotMessage('{"c":"bash ls","s":"s1"}')).toEqual({
            sessionId: "s1",
            command: "bash ls",
        });
        expect(parseSnapshotMessage('{"c":"bash ls"}')).toEqual({
            sessionId: null,
            command: "bash ls",
        });
    });
});
