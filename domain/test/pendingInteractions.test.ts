import { describe, it, expect, beforeEach } from "vitest";
import {
    registerInteraction,
    resolveInteraction,
    unregisterInteraction,
} from "../src/pendingInteractions";

describe("pendingInteractions（AC-002）", () => {
    beforeEach(() => {
        // 清可能残留（其他用例的 id）
    });

    it("register→resolve 唤醒 promise 返回 answers", async () => {
        const id = "p1";
        const p = new Promise<string[]>((resolve) =>
            registerInteraction(id, { resolve })
        );
        // 异步 resolve
        setTimeout(() => resolveInteraction(id, ["ans1", "ans2"]), 0);
        const answers = await p;
        expect(answers).toEqual(["ans1", "ans2"]);
    });

    it("resolve 未知 id → false，无副作用", () => {
        expect(resolveInteraction("nonexistent", ["x"])).toBe(false);
    });

    it("unregister 后 resolve 不再唤醒（落败清理防迟到 POST）", async () => {
        const id = "p2";
        let resolved: string[] | undefined;
        registerInteraction(id, { resolve: (a) => (resolved = a) });
        unregisterInteraction(id);
        expect(resolveInteraction(id, ["late"])).toBe(false);
        // 给微任务机会，确认未唤醒
        await new Promise((r) => setTimeout(r, 5));
        expect(resolved).toBeUndefined();
    });

    it("重复 resolve 同一 id 只第一次唤醒", async () => {
        const id = "p3";
        let calls = 0;
        const answers: string[][] = [];
        registerInteraction(id, {
            resolve: (a) => {
                calls++;
                answers.push(a);
            },
        });
        expect(resolveInteraction(id, ["first"])).toBe(true);
        expect(resolveInteraction(id, ["second"])).toBe(false);
        expect(calls).toBe(1);
        expect(answers).toEqual([["first"]]);
    });
});
