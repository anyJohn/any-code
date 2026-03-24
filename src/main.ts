import { OpenAI } from "openai";
import { ChatCompletionMessage } from "openai/resources/index";
import { tools, toolsMap } from "./tools";
import { loadMemory } from "./memory";
import { Config } from "./config";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * 调用 LLM
 * @param messages
 * @returns
 */
async function callLLM(
  messages: ChatMessage[],
): Promise<ChatCompletionMessage> {
  const config = new Config();
  const { apiKey, baseURL, model } = config;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is required");
    process.exit(1);
  }
  const client = new OpenAI({
    apiKey,
    baseURL,
  });
  const resp = await client.chat.completions.create({
    model,
    messages,
    tools,
  });
  return resp.choices[0]?.message;
}

/**
 * 核心代码，实现AgentLoop，通过循环让大模型持续使用工具
 * @param userInput
 * @param maxIterations
 * @returns
 */
async function agentLoop(userInput: string, maxIterations = 20) {
  const memory = loadMemory();
  let systemPrompt =
    "You are a powerful code assistant. First, figure out what kind of project & system this is. Last, Be concise and helpful.";
  if (memory) {
    systemPrompt += `Previous context:\n${memory}`;
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userInput,
    },
  ];
  for (let i = 0; i < maxIterations; i++) {
    console.log(`\n[Iteration ${i + 1}/${maxIterations}]`);
    const msg = await callLLM(messages);
    messages.push(msg);
    if (msg.content) {
      console.log(`\nAssistant: ${msg.content}`);
    }
    if (msg?.tool_calls?.length) {
      for (const toolCall of msg.tool_calls) {
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
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolOutput,
          });
        }
      }
    } else {
      // No more tool calls, we're done
      break;
    }
  }
  return messages;
}

async function main() {
  console.log("starting");
  const args = process.argv.slice(2);
  const userInput =
    args.length > 0 ? args.join(" ") : "List files in current directory";

  console.log("=== Any-Agent-Nano ===");
  console.log(`User: ${userInput}\n`);

  await agentLoop(userInput);
}

main().catch(console.error);

export default main;
