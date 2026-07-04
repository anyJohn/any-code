import fs from "fs/promises";
import path from "path";
import { EventType } from "../../type";
import type { ToolContext } from "../../context";
import { resolvePath } from "../../workspace";

interface ExploreArgs {
    directoryPath?: string;
    maxDepth?: number;
    ignorePatterns?: string[];
}

interface DirectoryNode {
    name: string;
    type: "file" | "directory";
    path: string;
    children?: DirectoryNode[];
}

const DEFAULT_IGNORE_PATTERNS = [
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".DS_Store",
    "*.log",
    ".env",
    ".env.*",
];

async function exploreDirectory(
    dirPath: string,
    currentDepth: number,
    maxDepth: number,
    ignorePatterns: string[]
): Promise<DirectoryNode> {
    const name = path.basename(dirPath);
    const node: DirectoryNode = {
        name,
        type: "directory",
        path: dirPath,
        children: [],
    };

    if (currentDepth > maxDepth) {
        return node;
    }

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const shouldIgnore = ignorePatterns.some((pattern) => {
                if (pattern.startsWith("*")) {
                    return entry.name.endsWith(pattern.slice(1));
                }
                return entry.name === pattern;
            });

            if (shouldIgnore) continue;

            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                const childNode = await exploreDirectory(
                    fullPath,
                    currentDepth + 1,
                    maxDepth,
                    ignorePatterns
                );
                node.children!.push(childNode);
            } else {
                node.children!.push({
                    name: entry.name,
                    type: "file",
                    path: fullPath,
                });
            }
        }
    } catch (error) {
        node.children = undefined;
    }

    return node;
}

function formatTree(
    node: DirectoryNode,
    indent: string = "",
    isLast: boolean = true
): string {
    const prefix =
        indent === "" ? "" : indent.slice(0, -2) + (isLast ? "└─ " : "├─ ");
    let result =
        prefix + node.name + (node.type === "directory" ? "/" : "") + "\n";

    if (node.children && node.children.length > 0) {
        const newIndent = indent + (isLast ? "   " : "│  ");
        for (let i = 0; i < node.children.length; i++) {
            result += formatTree(
                node.children[i],
                newIndent,
                i === node.children.length - 1
            );
        }
    }

    return result;
}

export const exploreFunc = async (
    args: ExploreArgs,
    ctx: ToolContext
): Promise<string> => {
    const { workspace, eventStream } = ctx;
    try {
        const { maxDepth = 3 } = args;
        const directoryPath = args.directoryPath
            ? resolvePath(workspace, args.directoryPath)
            : workspace.rootPath;
        // 用户未显式传 ignorePatterns 时，用 workspace 的（含 node_modules/.git 等）
        const ignorePatterns = args.ignorePatterns ?? workspace.ignoredPatterns;

        eventStream.submit({
            type: EventType.TOOL,
            message: `Exploring directory`,
            data: { path: directoryPath, maxDepth },
        });

        const absolutePath = path.resolve(directoryPath);
        const rootNode = await exploreDirectory(
            absolutePath,
            0,
            maxDepth,
            ignorePatterns
        );

        let output = `Directory Structure: ${absolutePath}\n`;
        output += `Max Depth: ${maxDepth}\n`;
        output += `Ignored: ${ignorePatterns.join(", ")}\n\n`;
        output += formatTree(rootNode);

        return output;
    } catch (error) {
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};
