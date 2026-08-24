import { spawn } from "node:child_process";
import { rgPath } from "@vscode/ripgrep";

export interface RipgrepResult {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
}

/**
 * spawn ripgrep（@vscode/ripgrep 打包二进制，不依赖系统 rg）。纯 argv 向量（无 shell，防注入），
 * 强制 --no-config 防 host RIPGREP_CONFIG_PATH 注入预处理器。SPEC-021 B-001 / DEC-075。
 *
 * .gitignore：rg 默认尊重 .gitignore 并跳过 hidden 目录——glob/grep 均沿用默认
 * （--no-ignore 会 flood node_modules，不适用源码 workspace）。
 */
export function runRipgrep(
    args: string[],
    opts: { cwd: string; signal?: AbortSignal }
): Promise<RipgrepResult> {
    return new Promise((resolve) => {
        const child = spawn(rgPath, ["--no-config", ...args], {
            cwd: opts.cwd,
            signal: opts.signal,
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => {
            stdout += d.toString();
        });
        child.stderr.on("data", (d: Buffer) => {
            stderr += d.toString();
        });
        child.on("error", () =>
            resolve({ stdout, stderr, code: null, signal: null })
        );
        child.on("close", (code, signal) =>
            resolve({ stdout, stderr, code, signal })
        );
    });
}
