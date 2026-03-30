import { agentLoop } from "./core";
import { ChatMessage } from "./type";
import { readOnlyTools } from "./tools";
import z from "zod";

const schema = z.object({
  subTasks: z.array(z.string()),
});
export async function createPlan(task: string): Promise<string[]> {
  console.log("[Planning] Start Planning...");
  const msg: ChatMessage[] = getPlanMessage(task);
  const { result } = await agentLoop(`[Task]: ${task}`, msg, undefined, {
    tools: readOnlyTools,
  });
  try {
    const json = JSON.parse(result);
    const subTasks: string[] = schema.parse(json)?.subTasks;
    console.log("[Plan] Created:");
    console.log(subTasks.map((t, i) => `${i + 1}. ${t}`).join("\n"));
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
      content: `Break down the task into 3-5 simple, readable, actionable steps. Must include test. Return a JSON array of strings.
Schema:
{
  "subTasks": string[],
}
- Return ONLY JSON
- No Markdown
- No Explanation
- Must be valid JSON
- No Command
- No Script or Code Block
- 不要输出编码，只做计划

**Available Tools:**
${readOnlyTools.map((t) => `- ${t.type}: ${t.type}`).join("\n")}

Important Notes:
- ONLY use the tools listed above
- DO NOT create, write, edit, modify or delete file during planning
`,
    },
  ];
}