import { runRipgrep } from "../../ripgrep";
import type { ToolContext } from "../../context";
import { resolvePath } from "../../workspace";

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
        const cwd = args.path
            ? resolvePath(workspace, args.path)
            : workspace.rootPath;

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
        rgArgs.push(cwd);

        const { stdout, stderr, code } = await runRipgrep(rgArgs, { cwd });

        // code 1 = 无匹配（正常），code 2 = 错误
        if (code === 2) {
            return `Error: ${stderr.trim() || "ripgrep error"}`;
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
