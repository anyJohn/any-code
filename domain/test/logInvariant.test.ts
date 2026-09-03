import { describe, it, expect } from "vitest";
import { countUnloggedMessages } from "../src/core";
import { systemFingerprint } from "../src/prompt";
import {
    entriesToSession,
    metaOf,
    sysFpMetaEntry,
    type SessionEntry,
} from "../src/session/session";
import { SessionService } from "../src/session/sessionService";
import { LocalSessionStore } from "../src/session/sessionStore";
import type { ChatMessage } from "../src/type";

// AR-23 会话日志不变式：
// 1) 运行时断言——countUnloggedMessages 统计"未确认落盘却进入请求"的非 system 消息；
// 2) system prompt 指纹——动态装配内容不入盘，sysfp meta 留哈希（末条为准）；
// 3) 崩溃重建——resume 出的消息与"喂给模型的历史"一致（acceptance）。

const u = (c: string): ChatMessage =>
    ({ role: "user", content: c }) as never;
const a = (c: string): ChatMessage =>
    ({ role: "assistant", content: c }) as never;
const sys = (c: string): ChatMessage =>
    ({ role: "system", content: c }) as never;

describe("countUnloggedMessages（AR-23 运行时断言）", () => {
    it("全部落盘 → 0；混入未落盘消息 → 计数（跳过 [0] system 与中途 system）", () => {
        const m1 = u("q1");
        const m2 = a("a1");
        const head = sys("system prompt");
        const ghost = u("ghost"); // 未走 onMessage 的"幽灵消息"
        const seen = new WeakSet<object>([m1 as unknown as object, m2 as unknown as object]);
        const messages = [head, m1, m2, sys("中途 system 不计"), ghost];
        expect(countUnloggedMessages(messages, seen)).toBe(1);
    });

    it("空 seen：除 system 外全部计为未落盘", () => {
        const seen = new WeakSet<object>();
        expect(countUnloggedMessages([sys("s"), u("a"), a("b")], seen)).toBe(2);
    });
});

describe("systemFingerprint（AR-23）", () => {
    it("同内容同指纹；异内容异指纹；16 hex", () => {
        expect(systemFingerprint("abc")).toBe(systemFingerprint("abc"));
        expect(systemFingerprint("abc")).not.toBe(systemFingerprint("abd"));
        expect(systemFingerprint("abc")).toMatch(/^[0-9a-f]{16}$/);
    });
});

describe("sysfp meta fold（AR-23）", () => {
    it("末条为准；无记录缺省", () => {
        const entries: SessionEntry[] = [
            { kind: "meta", title: "t", updatedAt: 1 },
            { kind: "meta", updatedAt: 2, sysfp: { hash: "aaa" } },
            { kind: "meta", updatedAt: 3, sysfp: { hash: "bbb", model: "m1" } },
        ];
        expect(entriesToSession("id", entries).sysfp).toEqual({ hash: "bbb", model: "m1" });
        expect(metaOf("id", entries)?.sysfp).toEqual({ hash: "bbb", model: "m1" });
        expect(entriesToSession("id", [{ kind: "meta", updatedAt: 1 }]).sysfp).toBeUndefined();
    });
});

describe("崩溃重建（AR-23 acceptance）", () => {
    const PK = "/ws-ar23";
    it("任意时刻 resume：消息序列与落盘一致；replaceMessages 保留 usage/sysfp meta", async () => {
        const svc = new SessionService(new LocalSessionStore());
        const session = await svc.create(PK, "ar23");
        const key = { projectKey: PK, sessionId: session.id };
        // 逐条落盘（= onMessage 路径），每步都算一次"喂给模型的上下文"
        await svc.appendSysFp(key, { hash: "fp1", model: "m" });
        await svc.appendMessage(key, u("q1"));
        await svc.appendMessage(key, a("a1"));
        await svc.appendUsage(key, { ...sys("x") } as never, {
            promptTokens: 10,
            completionTokens: 1,
        }); // usage 走同 store
        await svc.appendMessage(key, u("q2"));
        await svc.appendMessage(key, a("a2"));
        // 记录崩溃前上下文（排除 system head）
        const before = [u("q1"), a("a1"), u("q2"), a("a2")];
        // "崩溃"：全新 service/store 从盘重建
        const svc2 = new SessionService(new LocalSessionStore());
        const resumed = await svc2.resume(PK, session.id);
        expect(resumed?.messages).toEqual(before);
        // 指纹与用量在重写后仍在：replaceMessages 全量重写不丢 meta
        await svc2.replaceMessages(key, [sys("new head"), u("q1"), a("a1")]);
        const svc3 = new SessionService(new LocalSessionStore());
        const r3 = await svc3.resume(PK, session.id);
        expect(r3?.sysfp).toEqual({ hash: "fp1", model: "m" });
        expect(r3?.usage?.promptTokens).toBe(10);
        expect(r3?.messages).toEqual([u("q1"), a("a1")]);
        // list 的 meta 同样带指纹
        const list = await svc3.list(PK);
        expect(list.find((x) => x.id === session.id)?.sysfp).toEqual({
            hash: "fp1",
            model: "m",
        });
    });
});
