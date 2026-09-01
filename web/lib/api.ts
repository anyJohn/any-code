/**
 * apiJson —— 统一的 JSON GET/POST 封装。
 *
 * 为什么要包一层：5xx 时 body 可能是 HTML 错误页（反向代理/静态层），
 * 裸 `.then(r => r.json())` 会把 HTML 当 JSON 解析，抛出
 * `Unexpected token '<'`，成为未捕获 rejection。
 *
 * 这里做两件事：
 * 1. r.ok 不成立时不解析 body，返回 null（调用方优雅降级，不抛未捕获异常）。
 * 2. 对 5xx 重试一次（短延迟，跨过瞬时失败）；仍失败再返回 null。
 */
export async function apiJson<T>(
    input: string,
    init?: RequestInit & { retries?: number }
): Promise<T | null> {
    const retries = init?.retries ?? 1;
    const { retries: _omit, ...rest } = init ?? {};
    let lastStatus = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(input, rest);
            lastStatus = res.status;
            if (!res.ok) {
                // 5xx 且还能重试 → 等一小段再试（dev 冷编译通常百毫秒级）
                if (res.status >= 500 && attempt < retries) {
                    await new Promise((r) => setTimeout(r, 200));
                    continue;
                }
                return null;
            }
            return (await res.json()) as T;
        } catch (err) {
            // 网络异常 / JSON 解析失败：可重试则重试，否则返回 null
            if (attempt >= retries) {
                // eslint-disable-next-line no-console
                console.error("[apiJson] failed:", input, err);
                return null;
            }
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    // eslint-disable-next-line no-console
    console.error(`[apiJson] ${input} 最终失败 status=${lastStatus}`);
    return null;
}
