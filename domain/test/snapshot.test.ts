import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSnapshotService } from "../src/snapshot";
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
