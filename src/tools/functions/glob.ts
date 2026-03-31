import { glob } from "glob";
interface GlobArgs {
  pattern: string;
  path?: string;
}

export const globFunc = async (args: GlobArgs): Promise<string> => {
  try {
    console.log(
      `[Tool Call] Glob pattern: ${args.pattern}, Path: ${args.path || process.cwd()}`,
    );
    const { pattern, path } = args;
    const options = path ? { cwd: path } : undefined;
    const files = await glob(pattern, options);

    if (files.length === 0) {
      return `No files found matching pattern: ${pattern}`;
    }

    return files.sort().join("\n");
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
};
