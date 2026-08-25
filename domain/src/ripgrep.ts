import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { globalConfigDir } from "./workspace";

export interface RipgrepResult {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
}

let cachedRg: string | undefined;

/**
 * ripgrep 二进制路径解析（async：@vscode/ripgrep 是 ESM，需 dynamic import）。候选序：
 * 1. ANYCODE_RG_PATH env（launcher 注入 vendored rg 路径，standalone 运行时走这条）
 * 2. ~/.anycode/runtime/rg/rg(.exe)（安装器 vendored）
 * 3. @vscode/ripgrep 的 rgPath（dev / 非 standalone fallback；standalone 下该包未被 trace，
 *    dynamic import 抛错→catch 忽略，靠 1/2）
 */
async function rgBinary(): Promise<string> {
    if (cachedRg !== undefined) return cachedRg;
    const win = platform() === "win32";
    const candidates = [
        process.env.ANYCODE_RG_PATH,
        join(globalConfigDir(), "runtime", "rg", win ? "rg.exe" : "rg"),
    ];
    try {
        const m = await import("@vscode/ripgrep");
        if (m.rgPath) candidates.push(m.rgPath);
    } catch {
        // @vscode/ripgrep 不可解析（standalone 下未 trace），忽略——靠 vendored 候选
    }
    const found = candidates.find((p): p is string => !!p && existsSync(p));
    if (!found) {
        throw new Error(
            "ripgrep binary not found（重装 anycode，或设 ANYCODE_RG_PATH 指向 rg 二进制）"
        );
    }
    cachedRg = found;
    return found;
}

/**
 * spawn ripgrep。纯 argv 向量（无 shell，防注入），强制 --no-config 防 host
 * RIPGREP_CONFIG_PATH 注入预处理器。.gitignore：rg 默认尊重 .gitignore 并跳过 hidden。
 */
export function runRipgrep(
    args: string[],
    opts: { cwd: string; signal?: AbortSignal }
): Promise<RipgrepResult> {
    return rgBinary()
        .then(
            (rg) =>
                new Promise<RipgrepResult>((resolve) => {
                    const child = spawn(rg, ["--no-config", ...args], {
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
                })
        )
        .catch((e) => ({
            stdout: "",
            stderr: `ripgrep: ${(e as Error).message}`,
            code: null,
            signal: null,
        }));
}
