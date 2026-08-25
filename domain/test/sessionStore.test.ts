import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// baseDir() 惰性读 os.homedir()（posix 每次 call 读 HOME env）。测试前设 HOME 到临时目录，
// import 后、调用 store 前生效——避免污染真实 ~/.anycode。
let home: string;
const ORIG_HOME = process.env.HOME;

import { LocalSessionStore } from "../src/session/sessionStore";
import { SessionService } from "../src/session/sessionService";
import { entriesToSession, projectKeyOf } from "../src/session/session";
import type { ChatMessage } from "../src/type";

const PK = projectKeyOf("/ws");
const u = (c: string): ChatMessage => ({ role: "user", content: c }) as never;
const a = (c: string): ChatMessage => ({ role: "assistant", content: c }) as never;
const sys = (c: string): ChatMessage => ({ role: "system", content: c }) as never;

describe("replaceMessages（AC-005 原子重写）", () => {
    let svc: SessionService;
    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), "anycode-compact-"));
        process.env.HOME = home;
        svc = new SessionService(new LocalSessionStore());
    });
    afterEach(() => {
        rmSync(home, { recursive: true, force: true });
        if (ORIG_HOME === undefined) delete process.env.HOME;
        else process.env.HOME = ORIG_HOME;
    });

    it("原 5 条压缩为 2 条 → reload 后 messages=2，title/createdAt 保留", async () => {
        const session = await svc.create(PK, "原标题");
        const key = { projectKey: PK, sessionId: session.id };
        for (const m of [u("u1"), a("a1"), u("u2"), a("a2"), u("u3")]) {
            await svc.appendMessage(key, m);
        }
        const before = await svc.resume(PK, session.id);
        expect(before?.messages).toHaveLength(5);
        const origCreated = before!.createdAt;

        // 压缩：替换为 [system, summary, tail]（system 不入盘 → 2 条落盘）
        const compacted: ChatMessage[] = [sys("S"), u("摘要"), a("a3")];
        await svc.replaceMessages(key, compacted);

        const after = await svc.resume(PK, session.id);
        expect(after).toBeTruthy();
        expect(after!.messages).toHaveLength(2); // system 不入盘
        expect((after!.messages[0] as Record<string, unknown>).content).toBe(
            "摘要"
        );
        expect(after!.title).toBe("原标题");
        expect(after!.createdAt).toBe(origCreated);
        expect(after!.updatedAt).toBeGreaterThanOrEqual(origCreated);
    });

    it("原子性：写临时文件 + rename，无残留 .tmp", async () => {
        const session = await svc.create(PK, "t");
        const key = { projectKey: PK, sessionId: session.id };
        await svc.appendMessage(key, u("u1"));
        await svc.replaceMessages(key, [sys("S"), u("x")]);
        const file = join(home, ".anycode", "projects", PK, `${session.id}.jsonl`);
        expect(existsSync(file)).toBe(true);
        expect(existsSync(`${file}.tmp`)).toBe(false);
    });

    it("与 appendMessage 一致：system 不落盘", async () => {
        const session = await svc.create(PK, "t");
        const key = { projectKey: PK, sessionId: session.id };
        await svc.replaceMessages(key, [sys("S"), u("x"), a("y")]);
        const entries = await new LocalSessionStore().load(key);
        const msgs = entries!.filter((e) => e.kind === "message");
        // system 不落盘 → 只剩 u("x") + a("y")
        expect(msgs).toHaveLength(2);
        expect(msgs.every((e) => (e as { message: ChatMessage }).message.role !== "system")).toBe(true);
        void entriesToSession;
    });
});
