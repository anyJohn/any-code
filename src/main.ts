import { loadMemory, saveMemory } from "./memory";
import { ChatMessage } from "./type";
import { createPlan } from "./plan";
import { agentLoop } from "./core";

async function getSystemMessage(planText?: string): Promise<ChatMessage[]> {
  const memory = loadMemory();
  let systemPrompt = `You are a powerful code assistant. First, figure out what kind of project & system this is. Last, Be concise and helpful.`;
  
  if (planText) {
    systemPrompt += `\n\nTask Steps:\n${planText}`;
  }
  
  if (memory) {
    systemPrompt += `\n\nPrevious context:\n${memory}`;
  }

  return [
    {
      role: "system",
      content: systemPrompt,
    },
  ];
}

async function main() {
  console.log("starting");
  const args = process.argv.slice(2);

  const hasPlanParam = args.includes("--plan");
  const taskArgs = args.filter(
    (arg) => arg !== "--plan",
  );
  const task: string =
    taskArgs.length > 0
      ? taskArgs.join(" ")
      : "List files in current directory";

  console.log("=== Any-Agent-Nano ===");
  console.log(`User: ${task}\n`);

  let systemMessages: ChatMessage[];
  if (hasPlanParam) {
    const tasks = await createPlan(task);
    systemMessages = await getSystemMessage(tasks.join("\n"));
  } else {
    systemMessages = await getSystemMessage();
  }

  const { result } = await agentLoop(task, systemMessages);
  saveMemory(task, result);
}

main().catch(console.error);

export default main;
