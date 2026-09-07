import type { ChildProcess } from "node:child_process";

/**
 * 击杀子进程整棵树（FR-28 发现的 CI 失败根因）：`sh -c "sleep 5"` 不转发 SIGTERM
 * 给孙进程——只 kill sh 会留下孤儿（sleep 跑满、jobs 永不 done）。
 * spawn 需配 detached（POSIX 下 child 自成进程组长），再 kill(-pid) 端整组。
 */
export function killTree(child: ChildProcess): void {
    if (child.pid === undefined || child.exitCode !== null) return;
    if (process.platform === "win32") {
        // Windows 无进程组：taskkill /T 端树（SIGTERM 对无 GUI 进程等效终止）
        try {
            const { spawn } = require("node:child_process") as typeof import("node:child_process");
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        } catch {
            child.kill("SIGKILL");
        }
        return;
    }
    try {
        process.kill(-child.pid, "SIGTERM");
    } catch {
        child.kill("SIGTERM");
    }
    // 宽限后强制：sh 忽略 SIGTERM 的场景兜底
    setTimeout(() => {
        if (child.exitCode !== null) return;
        try {
            process.kill(-child.pid!, "SIGKILL");
        } catch {
            try {
                child.kill("SIGKILL");
            } catch {
                // 已退出
            }
        }
    }, 800).unref();
}

/** spawn 选项：POSIX 下 detached 使 child 自成进程组（killTree 依赖）。 */
export const detachedIfPosix = process.platform === "win32" ? {} : { detached: true };
