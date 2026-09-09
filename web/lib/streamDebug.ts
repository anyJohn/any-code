/**
 * 流式链路取证日志（双气泡排查 2026-09-09）。
 * 环形缓冲存 localStorage + window 镜像；终态时 flushToServer 落盘
 * ~/.anycode/logs/client-debug.log。仅记录战略帧（非 Thinking/delta 高频帧）。
 */
const KEY = "anycode:stream-debug";
const MAX = 800;
const buf: string[] = [];

export function dbgLog(line: string): void {
    const entry = `${new Date().toISOString()} ${line}`;
    buf.push(entry);
    if (buf.length > MAX) buf.shift();
    try {
        localStorage.setItem(KEY, buf.join("\n"));
    } catch {
        // 配额满：放弃持久化，内存仍有
    }
    // devtools 可见
    // eslint-disable-next-line no-console
    console.debug("[stream]", entry);
}

export function dbgDump(): string[] {
    return [...buf];
}

/** 终态时把缓冲交给 server 落盘（失败静默——取证不干扰主流程）。 */
export function dbgFlushToServer(sessionId: string | null): void {
    if (!buf.length) return;
    try {
        const p = fetch("/api/debug/client-log", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, lines: buf }),
            keepalive: true,
        });
        if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
        // 取证不干扰主流程
    }
}
