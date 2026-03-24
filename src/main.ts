import { toolsMap } from "./tools";
import { loadMemory, saveMemory } from "./memory";
import { AgentLoopResult, ChatMessage } from "./type";
import { callLLM } from "./llm";
import { ChatCompletionMessageToolCall } from "openai/resources/index";

/**
 * 核心代码，实现AgentLoop，通过循环让大模型持续使用工具
 * @param task
 * @param maxIterations
 * @returns
 */
async function agentLoop(
  task: string,
  messages: ChatMessage[],
  maxIterations = 20,
): Promise<AgentLoopResult> {
  messages.push({
    role: "user",
    content: task,
  });
  for (let i = 0; i < maxIterations; i++) {
    console.log(`\n[Iteration ${i + 1}/${maxIterations}]`);
    const msg = await callLLM(messages);
    messages.push(msg);
    if (msg.content) {
      console.log(`\nAssistant: ${msg.content}`);
    }
    if (!msg?.tool_calls) {
      return {
        result: msg.content || "",
        messages,
      };
    } else {
      messages.push(...(await toolCall(msg.tool_calls)));
    }
  }
  return {
    result: "Max iterations reached",
    messages,
  };
}

async function toolCall(
  tooCalls: ChatCompletionMessageToolCall[],
): Promise<ChatMessage[]> {
  const result: ChatMessage[] = [];
  for (const toolCall of tooCalls) {
    if (toolCall.type === "function") {
      const funcName: string = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || "{}");
      console.log(`\n[Tool Call] ${funcName}:`, args);
      let toolOutput = "";
      if (typeof toolsMap[funcName] === "function") {
        toolOutput = await toolsMap[funcName](args);
        console.log(`[Output]:\n${toolOutput}`);
      } else {
        toolOutput = `Unknown tool: ${funcName}`;
      }
      result.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolOutput,
      });
    }
  }
  return result;
}

function getSystemMessage(): ChatMessage[] {
  const memory = loadMemory();
  let systemPrompt =
    "You are a powerful code assistant. First, figure out what kind of project & system this is. Last, Be concise and helpful.";
  if (memory) {
    systemPrompt += `Previous context:\n${memory}`;
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
  const task: string =
    args.length > 0 ? args.join(" ") : "List files in current directory";

  console.log("=== Any-Agent-Nano ===");
  console.log(`User: ${task}\n`);
  const { result } = await agentLoop(task, getSystemMessage());
  saveMemory(task, result);
}

main().catch(console.error);

export default main;
