import fs from "fs/promises";
import { EventStream } from "../../eventStream";
import { EventType } from "../../type";

const eventStream = EventStream.getInstance();

interface EditFileArgs {
    filePath: string;
    oldString: string;
    newString: string;
}

export const editFunc = async (args: EditFileArgs): Promise<string> => {
    try {
        const { filePath, oldString, newString } = args;
        const content = await fs.readFile(filePath, "utf-8");

        if (!content.includes(oldString)) {
            return `Error: oldString not found in file. Cannot perform replacement.`;
        }

        const occurrences = (
            content.match(
                new RegExp(
                    oldString.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                    "g"
                )
            ) || []
        ).length;

        if (occurrences > 1) {
            return `Error: oldString appears ${occurrences} times in the file. Please make the oldString more specific to match only once.`;
        }

        const newContent = content.replace(oldString, newString);
        eventStream.submit({
            type: EventType.TOOL,
            message: `Editing file`,
            data: { filePath },
        });
        await fs.writeFile(filePath, newContent, "utf-8");

        return `Successfully edited file.\n--- Removed:\n${oldString}\n--- Added:\n${newString}`;
    } catch (error) {
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return `Error: ${String(error)}`;
    }
};
