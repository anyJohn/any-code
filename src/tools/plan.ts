import OpenAI from "openai";
import { createPlan } from "../plan";
import { agentLoop } from "../core";
import { getSystemMessage } from "../main";
import { executeTools } from ".";

interface PlanArgs {
  task: string;
}

export const planSchema: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "plan",
    description: "Essential tool for complex tasks! Break down complicated task into 3-5 simple, actionable steps with clear objectives, then execute each step sequentially to ensure successful completion.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The complex task to create a plan for (e.g., 'Build a todo app', 'Implement user authentication')",
        },
      },
      required: ["task"],
    },
  },
};

export const planFunc = async (args: PlanArgs): Promise<string> => {
  const { task } = args;
  const tasks = await createPlan(task);
  const taskResults = [];
  for (const t of tasks) {
    const res = await agentLoop(t, getSystemMessage(), undefined, {
      tools: executeTools,
    });
    taskResults.push(res);
  }
  const res = `[Plan Execution Results]\n${taskResults
    .map((r, i) => `Task ${i + 1}: ${r.result}`)
    .join("\n")}`;
  console.log(res);
  return res;
};
