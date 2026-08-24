import { runRipgrep } from "../../ripgrep";
import type { ToolContext } from "../../context";
import { resolvePath } from "../../workspace";

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
        const { stdout } = await runRipgrep(rgArgs, { cwd });
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
