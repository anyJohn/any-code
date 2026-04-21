import { agentLoop } from "./core";
import { ToolKit } from "./tools";
import { ChatMessage } from "./type";
import z from "zod";
import { planPrompt } from "./prompt";
import { EventStream } from "./eventStream";
import { EventType } from "./type";

const eventStream = EventStream.getInstance();

const schema = z.object({
    subTasks: z.array(z.string()),
});
export async function createPlan(task: string): Promise<string[]> {
    eventStream.submit({ type: EventType.PLANNING, message: "Start planning" });
    const msg: ChatMessage[] = getPlanMessage(task);
    const { result } = await agentLoop(`[Task]: ${task}`, msg, undefined, {
        tools: ToolKit.readOnlyTools,
    });
    try {
        const json = JSON.parse(result);
        const subTasks: string[] = schema.parse(json)?.subTasks;
        eventStream.submit({
            type: EventType.PLANNING,
            message: `Plan created with ${subTasks.length} subtasks`,
        });
        return subTasks;
    } catch (e) {
        eventStream.submit({
            type: EventType.PLANNING,
            message: "Failed to create plan, using original task as plan",
        });
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
