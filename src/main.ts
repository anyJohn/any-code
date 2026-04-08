import { loadMemory, saveMemory } from "./memory";
import { ChatMessage } from "./type";
import { agentLoop } from "./core";
import { systemPrompt } from "./prompt";
import { ToolKit } from "./tools";
import { loadRule } from "./rule";
import { loadSkills } from "./skill";
import { loadMcpTools } from "./mcp";

function getSystemMessage(): ChatMessage[] {
  const memory = loadMemory();
  const rule = loadRule();
  const skills = loadSkills();
  let sysPrompt = systemPrompt;
  if (memory) {
    sysPrompt += memory;
  }
  if (skills) {
    sysPrompt += skills;
  }
  if (rule) {
    sysPrompt += rule;
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
  const mcpTools = loadMcpTools();
  const { result } = await agentLoop(task, systemMessages, undefined, {
    tools: [...ToolKit.allTools, ...mcpTools],
  });
  saveMemory(task, result);
}

main().catch(console.error);

export default main;
