import { createPlan } from "../../plan";
import { agentLoop } from "../../core";
import { subtaskPrompt } from "../../prompt";
import { ChatMessage } from "../../type";
import { ToolKit } from "..";
import { loadMcpTools } from "../../mcp";
import { EventStream, EventType } from "../../eventStream";

const eventStream = EventStream.getInstance();

interface PlanArgs {
  task: string;
}

export const planFunc = async (args: PlanArgs): Promise<string> => {
  const { task } = args;
  eventStream.submit({ type: EventType.PLANNING, message: `Creating plan for task`, data: { task } });
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
    eventStream.submit({ type: EventType.PLANNING, message: `Executing subtask ${i + 1}/${tasks.length}`, data: { subtask: t } });
    const mcpTools = loadMcpTools();
    const res = await agentLoop(
      `[Subtask ${i + 1} of ${tasks.length}]: ${t}`,
      subtaskSystemMessages,
      undefined,
      {
        tools: [...ToolKit.executeTools, ...mcpTools],
      },
    );
    taskResults.push(res);
  }

  const res = `[Plan Execution Results]\n${taskResults
    .map((r, i) => `Task ${i + 1}: ${r.result}`)
    .join("\n")}`;
  eventStream.submit({ type: EventType.PLANNING, message: `Plan execution completed`, data: { totalTasks: tasks.length } });
  return res;
};
