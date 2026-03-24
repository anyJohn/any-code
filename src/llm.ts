import { ChatCompletionMessage } from "openai/resources/index";
import { ChatMessage } from "./type";
import { Config } from "./config";
import OpenAI from "openai";
import { tools } from "./tools";
/**
 * 调用 LLM
 * @param messages
 * @returns
 */
export async function callLLM(
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
