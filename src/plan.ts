import { agentLoop } from "./core";
import { ToolKit } from "./tools";
import { ChatMessage } from "./type";
import z from "zod";
import { planPrompt } from "./prompt";

const schema = z.object({
  subTasks: z.array(z.string()),
});
export async function createPlan(task: string): Promise<string[]> {
  console.log("[Planning] Start Planning...");
  const msg: ChatMessage[] = getPlanMessage(task);
  const { result } = await agentLoop(`[Task]: ${task}`, msg, undefined, {
    tools: ToolKit.readOnlyTools,
  });
  try {
    const json = JSON.parse(result);
    const subTasks: string[] = schema.parse(json)?.subTasks;
    console.log(
      "[Plan] Plan Created:\n",
      subTasks.map((t, i) => `${i + 1}. ${t}`).join("\n"),
    );
    return subTasks;
  } catch (e) {
    console.log(
      "[Plan] Failed to create plan. Let's just use the original task as the plan.",
    );
    return [task];
  }
}

function getPlanMessage(task: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: planPrompt,
    },
  ];
}
