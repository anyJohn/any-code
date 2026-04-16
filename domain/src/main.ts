import { loadMemory, saveMemory } from "./memory";
import { ChatMessage } from "./type";
import { agentLoop } from "./core";
import { systemPrompt } from "./prompt";
import { ToolKit } from "./tools";
import { loadRule } from "./rule";
import { loadSkills } from "./skill";
import { loadMcpTools } from "./mcp";
import { EventStream, EventType } from "./eventStream";

// 初始化事件流单例
const eventStream = EventStream.getInstance();

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

  eventStream.submit({ type: EventType.SYSTEM, message: "=== Any-Agent-Nano ===" });
  eventStream.submit({ type: EventType.USER, message: task });
  const mcpTools = loadMcpTools();
  const { result } = await agentLoop(task, systemMessages, undefined, {
    tools: [...ToolKit.allTools, ...mcpTools],
  });
  saveMemory(task, result);
}

main().catch((error) => eventStream.submit({ type: EventType.ERROR, message: `Main function error: ${error.message}`, data: error }));

export default main;
