import { loadMemory, saveMemory } from "./memory";
import { ChatMessage } from "./type";
import { agentLoop } from "./core";
import { systemPrompt } from "./prompt";

export function getSystemMessage(): ChatMessage[] {
  const memory = loadMemory();
  let sysPrompt = systemPrompt;

  if (memory) {
    sysPrompt += `\n\nPrevious context:\n${memory}\n\n`;
  }

  return [
    {
      role: "system",
      content: sysPrompt,
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
