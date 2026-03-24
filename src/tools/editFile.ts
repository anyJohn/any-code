import OpenAI from "openai";
import fs from "fs/promises";

interface EditFileArgs {
  filePath: string;
  oldString: string;
  newString: string;
}

export const editFileSchema: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "edit_file",
    description: "Edit a file by replacing an exact old_string with new_string",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The path to the file to edit",
        },
        oldString: {
          type: "string",
          description: "The exact string to replace in the file",
        },
        newString: {
          type: "string",
          description: "The new string to replace with",
        },
      },
      required: ["filePath", "oldString", "newString"],
    },
  },
};

export const editFileFunc = async (args: EditFileArgs): Promise<string> => {
  try {
    const { filePath, oldString, newString } = args;
    const content = await fs.readFile(filePath, "utf-8");

    if (!content.includes(oldString)) {
      return `Error: oldString not found in file. Cannot perform replacement.`;
    }

    const occurrences = (content.match(new RegExp(oldString.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

    if (occurrences > 1) {
      return `Error: oldString appears ${occurrences} times in the file. Please make the oldString more specific to match only once.`;
    }

    const newContent = content.replace(oldString, newString);
    await fs.writeFile(filePath, newContent, "utf-8");

    return `Successfully edited file.\n--- Removed:\n${oldString}\n--- Added:\n${newString}`;
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
};
