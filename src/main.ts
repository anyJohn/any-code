import { loadMemory, saveMemory } from "./memory";
import { ChatMessage } from "./type";
import { createPlan } from "./plan";
import { agentLoop } from "./core";

function getSystemMessage(): ChatMessage[] {
  const memory = loadMemory();
  let systemPrompt = `You are a powerful code assistant. First, figure out what kind of project & system this is. Last, Be concise and helpful.`;

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
  const taskArgs = args.filter((arg) => arg !== "--plan");
  const task: string =
    taskArgs.length > 0
      ? taskArgs.join(" ")
      : "List files in current directory";

  console.log("=== Any-Agent-Nano ===");
  console.log(`User: ${task}\n`);

  let systemMessages: ChatMessage[] = await getSystemMessage();
  if (hasPlanParam) {
    const tasks = await createPlan(task);
    const allResult: string[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const subtask = tasks[i];
      console.log(`\n[Executing Subtasks] [Task ${i + 1}] ${subtask}`);
      const { result } = await agentLoop(subtask, systemMessages);
      allResult.push(result);
    }

    const finalResult = allResult.join("\n");
    saveMemory(task, finalResult);
  } else {
    const { result } = await agentLoop(task, systemMessages);
    saveMemory(task, result);
  }
}

main().catch(console.error);

export default main;
