import { ChatCompletionCreateParamsNonStreaming } from "openai/resources/index";
import { callLLM } from "./llm";
import { toolCall } from "./tools";
import { AgentLoopResult, ChatMessage } from "./type";

/**
 * 核心代码，实现AgentLoop，通过循环让大模型持续使用工具
 * @param task
 * @param maxIterations
 * @returns
 */
export async function agentLoop(
  task: string,
  messages: ChatMessage[],
  maxIterations = 30,
  params?: Partial<ChatCompletionCreateParamsNonStreaming>,
): Promise<AgentLoopResult> {
  messages.push({
    role: "user",
    content: task,
  });
  for (let i = 0; i < maxIterations; i++) {
    console.log(`\n[Iteration ${i + 1}/${maxIterations}]`);
    const msg = await callLLM(messages, params);
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
      const accessToolKit =
        params?.tools?.map((t) => (t as any)?.function?.name) || undefined;
      messages.push(...(await toolCall(msg.tool_calls, accessToolKit)));
    }
  }
  return {
    result: "Max iterations reached",
    messages,
  };
}
