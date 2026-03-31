import OpenAI from "openai";
import { createPlan } from "../plan";
import { agentLoop } from "../core";
import { executeTools, ToolName } from ".";
import { subtaskPrompt } from "../prompt";
import { ChatMessage } from "../type";

interface PlanArgs {
  task: string;
}

export const planSchema: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: ToolName.Plan,
    description:
      "Essential tool for complex tasks! Break down complicated task into 3-5 simple, actionable steps with clear objectives, then execute each step sequentially to ensure successful completion.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "The complex task to create a plan for (e.g., 'Build a todo app', 'Implement user authentication')",
        },
      },
      required: ["task"],
    },
  },
};

export const planFunc = async (args: PlanArgs): Promise<string> => {
  const { task } = args;
  console.log(`[Tool Call] Planning for task: ${task}`);
  const tasks = await createPlan(task);
  const taskResults = [];

  // 为 subtask 创建专用的系统消息（不包含 plan 工具提示）
  const subtaskSystemMessages: ChatMessage[] = [
    {
      role: "system",
      content: subtaskPrompt,
    },
  ];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    console.log(`\n[Executing Subtask ${i + 1}/${tasks.length}]: ${t}`);

    const res = await agentLoop(
      `[Subtask ${i + 1} of ${tasks.length}]: ${t}`,
      subtaskSystemMessages,
      undefined,
      {
        tools: executeTools,
      },
    );
    taskResults.push(res);
  }

  const res = `[Plan Execution Results]\n${taskResults
    .map((r, i) => `Task ${i + 1}: ${r.result}`)
    .join("\n")}`;
  console.log(res);
  return res;
};
