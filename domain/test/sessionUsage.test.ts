import { describe, it, expect } from "vitest";
import {
    entriesToSession,
    metaOf,
    usageMetaEntry,
    type SessionEntry,
} from "../src/session/session";
import { SessionService } from "../src/session/sessionService";
import { LocalSessionStore } from "../src/session/sessionStore";
import type { AgentEvent } from "../src/type";

// FR-22 会话级用量累计：usage meta 增量 fold 求和（byModel 归并）+ appendUsage 落盘闭环。
// 验收：多轮后累计值 = 各轮之和；重进会话（resume）用量仍在。

const usageEvent = (prompt: number, completion: number): AgentEvent =>
    ({
        timestamp: Date.now(),
        type: "Usage",
        message: `${prompt}`,
        data: { prompt_tokens: prompt, completion_tokens: completion, contextWindow: 128000 },
    }) as never;

describe("usage meta fold（FR-22）", () => {
    it("多条增量求和：累计 = 各轮之和", () => {
        const entries: SessionEntry[] = [
            { kind: "meta", title: "t", updatedAt: 1 },
            { kind: "meta", updatedAt: 2, usage: { promptTokens: 100, completionTokens: 10 } },
            { kind: "meta", updatedAt: 3, usage: { promptTokens: 200, completionTokens: 20 } },
            { kind: "meta", updatedAt: 4, usage: { promptTokens: 300, completionTokens: 30 } },
        ];
        const s = entriesToSession("id", entries);
        expect(s.usage).toEqual({ promptTokens: 600, completionTokens: 60 });
        const meta = metaOf("id", entries);
        expect(meta?.usage).toEqual({ promptTokens: 600, completionTokens: 60 });
    });

    it("byModel 按模型戳归并；无模型戳的增量只进总数", () => {
        const entries: SessionEntry[] = [
            { kind: "meta", updatedAt: 1, usage: { promptTokens: 100, completionTokens: 10, model: "m1" } },
            { kind: "meta", updatedAt: 2, usage: { promptTokens: 50, completionTokens: 5, model: "m2" } },
            { kind: "meta", updatedAt: 3, usage: { promptTokens: 30, completionTokens: 3, model: "m1" } },
            { kind: "meta", updatedAt: 4, usage: { promptTokens: 7, completionTokens: 1 } },
        ];
        const s = entriesToSession("id", entries);
        expect(s.usage?.promptTokens).toBe(187);
        expect(s.usage?.completionTokens).toBe(19);
        expect(s.usage?.byModel).toEqual({
            m1: { promptTokens: 130, completionTokens: 13 },
            m2: { promptTokens: 50, completionTokens: 5 },
        });
    });

    it("无用量记录 → usage 缺省；usageMetaEntry 不带 title（沿用最近 title meta）", () => {
        const s = entriesToSession("id", [{ kind: "meta", title: "标题", updatedAt: 1 }]);
        expect(s.usage).toBeUndefined();
        const e = usageMetaEntry({ promptTokens: 1, completionTokens: 2 });
        expect(e.kind === "meta" && e.title).toBeUndefined();
    });
});

describe("SessionService.appendUsage（FR-22 落盘闭环）", () => {
    const PK = "/ws-test";
    it("appendUsage 三轮 → resume 与 list 的累计一致（= 各轮之和）", async () => {
        const svc = new SessionService(new LocalSessionStore());
        const session = await svc.create(PK, "用量会话");
        const key = { projectKey: PK, sessionId: session.id };
        const rounds: Array<[number, number, string | undefined]> = [
            [1000, 100, "gpt-x"],
            [2000, 200, "gpt-x"],
            [3000, 300, undefined],
        ];
        for (const [p, c, m] of rounds) {
            await svc.appendUsage(key, usageEvent(p, c), {
                promptTokens: p,
                completionTokens: c,
                ...(m ? { model: m } : {}),
            });
        }
        const resumed = await svc.resume(PK, session.id);
        expect(resumed?.usage?.promptTokens).toBe(6000);
        expect(resumed?.usage?.completionTokens).toBe(600);
        expect(resumed?.usage?.byModel?.["gpt-x"]).toEqual({
            promptTokens: 3000,
            completionTokens: 300,
        });
        const list = await svc.list(PK);
        const meta = list.find((x) => x.id === session.id);
        expect(meta?.usage?.promptTokens).toBe(6000);
        // title 不被用量 meta 冲掉
        expect(meta?.title).toBe("用量会话");
    });
});
