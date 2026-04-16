import fs from "fs/promises";
import path from "path";
import { glob } from "glob";
import { EventStream, EventType } from "../../eventStream";

const eventStream = EventStream.getInstance();

interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: "files_with_matches" | "content" | "count";
  multiline?: boolean;
  case_insensitive?: boolean;
}

async function* walkDir(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(fullPath);
    } else {
      yield fullPath;
    }
  }
}

async function searchFile(filePath: string, regex: RegExp): Promise<{ path: string; lines: { line: number; content: string }[] }> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const matches: { line: number; content: string }[] = [];

    lines.forEach((line, index) => {
      if (regex.test(line)) {
        matches.push({ line: index + 1, content: line });
      }
    });

    return { path: filePath, lines: matches };
  } catch {
    return { path: filePath, lines: [] };
  }
}

export const grepFunc = async (args: GrepArgs): Promise<string> => {
  try {
    const {
      pattern,
      path: searchPath = process.cwd(),
      glob: globPattern,
      output_mode = "content",
      multiline = false,
      case_insensitive = false,
    } = args;
    eventStream.submit({ type: EventType.TOOL, message: `Grep search`, data: { pattern, path: searchPath } });
    let flags = "g";
    if (multiline) flags += "m";
    if (case_insensitive) flags += "i";

    const regex = new RegExp(pattern, flags);

    let files: string[];
    if (globPattern) {
      files = await glob(globPattern, { cwd: searchPath });
      files = files.map((f) => path.join(searchPath, f));
    } else {
      const stat = await fs.stat(searchPath);
      if (stat.isDirectory()) {
        files = [];
        for await (const file of walkDir(searchPath)) {
          files.push(file);
        }
      } else {
        files = [searchPath];
      }
    }

    const results: { path: string; lines: { line: number; content: string }[] }[] = [];

    for (const file of files) {
      const result = await searchFile(file, regex);
      if (result.lines.length > 0) {
        results.push(result);
      }
    }

    if (output_mode === "files_with_matches") {
      if (results.length === 0) {
        return `No files found matching pattern: ${pattern}`;
      }
      return results.map((r) => r.path).join("\n");
    }

    if (output_mode === "count") {
      if (results.length === 0) {
        return `No matches found for pattern: ${pattern}`;
      }
      return results.map((r) => `${r.path}: ${r.lines.length} matches`).join("\n");
    }

    if (results.length === 0) {
      return `No matches found for pattern: ${pattern}`;
    }

    const output: string[] = [];
    for (const result of results) {
      output.push(`\n${result.path}:`);
      for (const line of result.lines) {
        output.push(`  ${line.line}: ${line.content}`);
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
