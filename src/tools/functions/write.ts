import fs from "fs/promises";

interface WriteArgs {
  filePath: string;
  content: string;
}

export const writeFunc = async (args: WriteArgs): Promise<string> => {
  try {
    console.log(
      `[Tool Call] Write to file: ${args.filePath}, Content length: ${args.content.length} characters`,
    );
    await fs.writeFile(args.filePath, args.content, "utf-8");
    return `Successfully wrote ${args.content.length} characters to ${args.filePath}`;
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
};
