import { loadMemory, saveMemory } from "./memory";
import { ChatMessage } from "./type";
import { agentLoop } from "./core";
import { systemPrompt, SubtaskPrompt } from "./prompt";

export function getSystemMessage(isSubtask: boolean = false): ChatMessage[] {
  const memory = loadMemory();
  let sysPrompt = isSubtask ? SubtaskPrompt : systemPrompt;
  let finalPrompt = sysPrompt;

  if (memory && !isSubtask) {
    finalPrompt += `\n\nPrevious context:\n${memory}\n\n`;
  }

  return [
    {
      role: "system",
      content: finalPrompt,
    },
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const task: string =
    args.length > 0 ? args.join(" ") : "List files in current directory";
  const systemMessages: ChatMessage[] = getSystemMessage();

  console.log("=== Any-Agent-Nano ===");
  console.log(`User: ${task}\n`);
  const { result } = await agentLoop(task, systemMessages);
  saveMemory(task, result);
}

main().catch(console.error);

export default main;
