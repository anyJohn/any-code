import { runRipgrep } from "../../ripgrep";
import type { ToolContext } from "../../context";
import { resolvePath } from "../../workspace";
import { existsSync } from "node:fs";

interface GlobArgs {
    pattern: string;
    path?: string;
}

const MAX_RESULTS = 100;

/**
 * 文件名 glob 搜索。用 ripgrep `rg --files -g PATTERN`——尊重 .gitignore、默认跳过
 * VCS/node_modules（hidden + ignored）。SPEC-021 B-002。
 */
export const globFunc = async (
    args: GlobArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    try {
        const cwd = args.path
            ? resolvePath(workspace, args.path)
            : workspace.rootPath;
        const rgArgs = ["--files"];
        if (args.pattern) rgArgs.push("--glob", args.pattern);
        const { stdout, stderr, code, spawnError } = await runRipgrep(rgArgs, {
            cwd,
        });
        // bugfix 2026-09-20：原先只看 stdout，忽略退出码——rg 因"目录不存在"以 code=2
        // 退出时 stdout 为空，被误报成「No files found」（假阴性，让人以为目录存在但为空）。
        if (code === 2 || code === null) {
            return `Error: ${describeGlobFailure({ stderr, spawnError, cwd })}`;
        }
        const files = stdout
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, MAX_RESULTS);
        if (files.length === 0) {
            return `No files found matching pattern: ${args.pattern}`;
        }
        return files.sort().join("\n");
    } catch (error) {
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};

/** rg 失败诊断（与 grep 同源逻辑）：区分"路径不存在"与"rg 二进制缺失"，避免假阴性。 */
function describeGlobFailure({
    stderr,
    spawnError,
    cwd,
}: {
    stderr: string;
    spawnError?: NodeJS.ErrnoException;
    cwd: string;
}): string {
    const stderrText = stderr.trim();
    if (!spawnError) return stderrText || `ripgrep 执行失败（cwd=${cwd}）`;
    if (spawnError.code === "ENOENT") {
        return existsSync(cwd)
            ? `ripgrep binary not found（重装 anycode，或设 ANYCODE_RG_PATH 指向 rg 二进制）`
            : `搜索路径不存在：${cwd}（先用 explore 确认路径，注意路径相对工作区根解析）`;
    }
    if (spawnError.code === "EACCES") {
        return `无权限访问：${cwd}（${spawnError.message}）`;
    }
    if (spawnError.code === "ENOTDIR") {
        return `路径中某一段不是目录：${cwd}`;
    }
    return `${spawnError.message}（cwd=${cwd}）`;
}
