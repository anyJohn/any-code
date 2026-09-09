import { describe, it } from "vitest";
import { toRenderItems, toRenderItemsIncremental, type RenderItem } from "../renderItems";
import type { AgentEvent } from "../sseEvents";

let uid = 0;
const ev = (type: string, msg: string, extra: Partial<AgentEvent> = {}): AgentEvent =>
    ({ id: `e${uid++}`, timestamp: 1700000000000 + uid, type, message: msg, ...extra } as AgentEvent);

const dump = (tag: string, items: RenderItem[]) =>
    console.error(
        tag,
        JSON.stringify(
            items.map((it) =>
                it.kind === "turn"
                    ? { s: it.startIdx, it: it.iteration?.message.slice(0, 6) ?? null, as: it.assistant?.message.slice(0, 6) ?? null, tools: it.tools.length }
                    : it.kind === "subagent"
                      ? { s: it.startIdx, sub: it.events.length }
                      : { s: it.startIdx, t: it.event.type }
            )
        )
    );

describe("最小复现（todo #14）", () => {
    it("step-by-step", () => {
        const events: AgentEvent[] = [
            ev("Thinking", "aaaa", { turnId: "t1" }),
            ev("Thinking", "bbbb", { turnId: "t1", runId: "r0", author: "plan" }),
            ev("AssistantDelta", "cccc", { turnId: "t1" }),
            ev("Tool", "bash", { turnId: "t1", data: { name: "bash", args: {}, result: "" } } as never),
            ev("Tool", "bash", { turnId: "t1", data: { name: "bash", args: {}, result: "" } } as never),
            ev("Warning", "warn"),
            ev("Tool", "bash", { turnId: "t1", data: { name: "bash", args: {}, result: "" } } as never),
            ev("Tool", "bash", { turnId: "t1", data: { name: "bash", args: {}, result: "" } } as never),
            ev("AssistantDelta", "dddd", { turnId: "t1" }),
            ev("Tool", "bash", { turnId: "t1", data: { name: "bash", args: {}, result: "" } } as never),
            ev("Iteration", "Iteration 1/150", { turnId: "t1" }),
            ev("Assistant", "ffff", { turnId: "t1" }),
        ];
        let cache: { events: AgentEvent[]; items: RenderItem[] } | undefined;
        for (let n = 1; n <= events.length; n++) {
            const inc = toRenderItemsIncremental(events.slice(0, n), cache);
            cache = { events: events.slice(0, n), items: inc };
            const full = toRenderItems(events.slice(0, n));
            const same = JSON.stringify(inc) === JSON.stringify(full);
            console.error(`--- n=${n} ${same ? "same" : "DIVERGE"}`);
            if (!same) {
                dump("  inc:", inc);
                dump("  full:", full);
            }
        }
    });
});
