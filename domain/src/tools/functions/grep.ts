import { runRipgrep } from "../../ripgrep";
import type { ToolContext } from "../../context";
import { resolvePath } from "../../workspace";
import { statSync, existsSync } from "node:fs";
import { dirname } from "node:path";

interface GrepArgs {
    pattern: string;
    path?: string;
    glob?: string;
    output_mode?: "files_with_matches" | "content" | "count";
    multiline?: boolean;
    case_insensitive?: boolean;
}

const MAX_MATCHES = 250;

/**
 * rg 失败原因诊断（bugfix 2026-09-20）：原先 spawn 失败（code=null）时错误对象被丢弃，
 * stderr 为空 → 只能回退成误导性的「ripgrep 启动失败」，真实原因（cwd 不存在 / 二进制缺失 /
 * 权限）全部丢失。这里按 errno 给出可执行的诊断，并附上 cwd 便于定位。
 */
function describeRgFailure({
    stderr,
    spawnError,
    cwd,
}: {
    stderr: string;
    spawnError?: NodeJS.ErrnoException;
    cwd: string;
}): string {
    const stderrText = stderr.trim();
    if (!spawnError) {
        // rg 自己退出码 2：stderr 有真实原因
        return stderrText || `ripgrep failed (cwd=${cwd})`;
    }
    const code = spawnError.code;
    if (code === "ENOENT") {
        // 区分「搜索路径不存在」与「rg 二进制不存在」——两者的修法完全不同
        const cwdExists = existsSync(cwd);
        return cwdExists
            ? `ripgrep binary not found (reinstall anycode, or set ANYCODE_RG_PATH to the rg binary)`
            : `Search path does not exist: ${cwd} (verify the path with explore or glob first; paths resolve relative to the workspace root)`;
    }
    if (code === "EACCES") {
        return `Permission denied: ${cwd} (${spawnError.message})`;
    }
    if (code === "ENOTDIR") {
        return `Not a directory (a path segment is a file): ${cwd}`;
    }
    return `${spawnError.message} (cwd=${cwd})`;
}

/**
 * 内容搜索。用 ripgrep `rg --regexp=PATTERN`——尊重 .gitignore、默认跳 VCS/node_modules。
 * SPEC-021 B-003。
 * rg 退出码：0=有匹配，1=无匹配，2=错误。
 */
export const grepFunc = async (
    args: GrepArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace } = ctx;
    try {
        const {
            pattern,
            glob: globPattern,
            output_mode = "content",
            multiline = false,
            case_insensitive = false,
        } = args;
        // path 兼许文件：rg 的搜索路径参数收文件；spawn cwd 必须是目录——文件时落到其父目录
        let rgPath: string | undefined;
        let cwd = args.path
            ? resolvePath(workspace, args.path)
            : workspace.rootPath;
        try {
            if (statSync(cwd).isFile()) {
                rgPath = cwd;
                cwd = dirname(cwd);
            }
        } catch {
            // 路径不存在：交给 rg 报错
        }

        const rgArgs: string[] = [];
        if (case_insensitive) rgArgs.push("-i");
        if (multiline) rgArgs.push("--multiline");
        if (globPattern) rgArgs.push("--glob", globPattern);

        if (output_mode === "files_with_matches") {
            rgArgs.push("--files-with-matches");
        } else if (output_mode === "count") {
            rgArgs.push("--count");
        } else {
            rgArgs.push("--with-filename", "--line-number", "--no-heading");
        }
        rgArgs.push("--regexp", pattern);
        // 显式传 path：rg 无 path 且 stdin 非 tty 时会读 stdin 阻塞，故显式给搜索路径
        rgArgs.push(rgPath ?? cwd);

        const { stdout, stderr, code, spawnError } = await runRipgrep(rgArgs, { cwd });

        // code 1 = 无匹配（正常），code 2 = 错误；null = spawn 失败——绝不能解释为"无匹配"
        if (code === 2 || code === null) {
            return `Error: ${describeRgFailure({ stderr, spawnError, cwd })}`;
        }

        const lines = stdout.split("\n").filter((l) => l !== "");

        if (output_mode === "files_with_matches") {
            if (lines.length === 0)
                return `No files found matching pattern: ${pattern}`;
            return lines.join("\n");
        }

        if (output_mode === "count") {
            if (lines.length === 0)
                return `No matches found for pattern: ${pattern}`;
            return lines
                .map((l) => {
                    // rg -c 输出 "file:count"
                    const idx = l.lastIndexOf(":");
                    const file = l.slice(0, idx);
                    const count = l.slice(idx + 1);
                    return `${file}: ${count} matches`;
                })
                .join("\n");
        }

        // content 模式：解析 "file:line:content"
        if (lines.length === 0) {
            return `No matches found for pattern: ${pattern}`;
        }
        const byFile = new Map<string, { line: number; content: string }[]>();
        for (const l of lines.slice(0, MAX_MATCHES)) {
            // 路径不含冒号（Linux），按前两个冒号拆 file:line:content
            const m = l.match(/^(.+?):(\d+):(.*)$/);
            if (!m) continue;
            const [, file, lineStr, content] = m;
            const line = Number(lineStr);
            if (!byFile.has(file)) byFile.set(file, []);
            byFile.get(file)!.push({ line, content });
        }
        const output: string[] = [];
        for (const [file, hits] of byFile) {
            output.push(`\n${file}:`);
            for (const h of hits) {
                output.push(`  ${h.line}: ${h.content}`);
            }
        }
        return output.join("\n").trim();
    } catch (error) {
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};
