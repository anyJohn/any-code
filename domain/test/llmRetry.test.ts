import { describe, it, expect, vi } from "vitest";
import { withRetry, isRetryableError, retryAfterDelayMs } from "../src/llm";

const httpErr = (status: number, headers?: Record<string, string>) => {
    const e = new Error(`HTTP ${status}`) as Error & {
        status?: number;
        headers?: Record<string, string>;
    };
    e.status = status;
    e.headers = headers;
    return e;
};

type RetryInfo = { attempt: number; maxRetries: number; delayMs: number; error: string };

describe("withRetry（AR-1 重试执行器）", () => {
    it("429 两次后成功：fn 共 3 次调用，onRetry 2 次，最终返回", async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(httpErr(429))
            .mockRejectedValueOnce(httpErr(429))
            .mockResolvedValueOnce("ok");
        const onRetry = vi.fn();
        const result = await withRetry(fn, {
            maxRetries: 3,
            baseDelayMs: 1,
            onRetry,
        });
        expect(result).toBe("ok");
        expect(fn).toHaveBeenCalledTimes(3);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1, maxRetries: 3 });
    });

    it("401 不可重试：fn 仅 1 次，直接抛", async () => {
        const fn = vi.fn().mockRejectedValue(httpErr(401));
        const onRetry = vi.fn();
        const err = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, onRetry }).then(
            () => new Error("EXPECTED_REJECTION_BUT_RESOLVED"),
            (e: unknown) => e as Error
        );
        expect(err.message).toBe("HTTP 401");
        expect(fn).toHaveBeenCalledTimes(1);
        expect(onRetry).not.toHaveBeenCalled();
    });

    it("超过 maxRetries 后抛最后一次错误", async () => {
        const fn = vi.fn().mockRejectedValue(httpErr(503));
        const onRetry = vi.fn();
        const err = await withRetry(fn, { maxRetries: 2, baseDelayMs: 1, onRetry }).then(
            () => new Error("EXPECTED_REJECTION_BUT_RESOLVED"),
            (e: unknown) => e as Error
        );
        expect(err.message).toBe("HTTP 503");
        expect(fn).toHaveBeenCalledTimes(3);
        expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it("Retry-After 头优先于指数退避（delayMs ≥ 1000）", async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(httpErr(429, { "retry-after": "1" }))
            .mockResolvedValueOnce("ok");
        const onRetry = vi.fn();
        await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, onRetry });
        expect(onRetry.mock.calls[0][0].delayMs).toBeGreaterThanOrEqual(1000);
    });

    it("重试等待期间 abort 立即中断（不再调用 fn）", async () => {
        const fn = vi.fn().mockRejectedValue(httpErr(429));
        const ac = new AbortController();
        const pending = withRetry(fn, {
            maxRetries: 5,
            baseDelayMs: 30_000,
            signal: ac.signal,
        });
        setTimeout(() => ac.abort(), 20);
        const err = await pending.then(
            () => new Error("EXPECTED_REJECTION_BUT_RESOLVED") as unknown as Error,
            (e: unknown) => e as Error
        );
        expect(fn).toHaveBeenCalledTimes(1); // abort 发生在首次重试的等待期，未再调用 fn
        expect(String(err?.message ?? err)).not.toContain("EXPECTED_REJECTION");
    });

    it("fn 成功后不再触发重试路径（onRetry 0 次）", async () => {
        const fn = vi.fn().mockResolvedValue("ok");
        const onRetry = vi.fn();
        const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, onRetry });
        expect(result).toBe("ok");
        expect(onRetry).not.toHaveBeenCalled();
    });
});

describe("错误分类（AR-1）", () => {
    it("isRetryableError：429/5xx/连接类/空响应可重试；4xx/abort 不可", () => {
        expect(isRetryableError(httpErr(429))).toBe(true);
        expect(isRetryableError(httpErr(500))).toBe(true);
        expect(isRetryableError(httpErr(503))).toBe(true);
        expect(isRetryableError(httpErr(400))).toBe(false);
        expect(isRetryableError(httpErr(401))).toBe(false);
        expect(isRetryableError({ name: "AbortError" })).toBe(false);
        expect(isRetryableError({ name: "APIConnectionError", message: "Connection error" })).toBe(true);
        expect(isRetryableError(new Error("LLM returned no content (model=m)"))).toBe(true);
        expect(isRetryableError(new Error("Invalid JSON"))).toBe(false);
    });

    it("retryAfterDelayMs：秒数与日期格式", () => {
        expect(retryAfterDelayMs(httpErr(429, { "retry-after": "2" }))).toBe(2000);
        expect(
            retryAfterDelayMs(httpErr(429, { "retry-after": new Date(Date.now() + 5000).toUTCString() }))
        ).toBeGreaterThanOrEqual(3000);
        expect(retryAfterDelayMs(new Error("x"))).toBeUndefined();
    });
});
