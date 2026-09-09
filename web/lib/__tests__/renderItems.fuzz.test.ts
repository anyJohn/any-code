import { describe, it, expect } from "vitest";
import {
    groupByTurn,
    toRenderItems,
    toRenderItemsIncremental,
    type RenderItem,
} from "../renderItems";
import type { AgentEvent } from "../sseEvents";

// 差分模糊：增量算法每一步必须与全量算法产出一致（同 startIdx/同 iteration/同内容轮廓）。
// todo #14 双气泡 = 渲染层重复，此测试抓 toRenderItemsIncremental 的缓存洞。

let uid = 0;
const ev = (type: string, msg: string, extra: Partial<AgentEvent> = {}): AgentEvent =>
    ({ id: `e${uid++}`, timestamp: 1700000000000 + uid, type, message: msg, ...extra } as AgentEvent);

const sig = (items: RenderItem[]) =>
    JSON.stringify(
        items.map((it) =>
            it.kind === "turn"
                ? {
                      k: "t",
                      s: it.startIdx,
                      it: it.iteration?.message ?? null,
                      th: it.thinking?.slice(0, 8) ?? null,
                      as: it.assistant?.message.slice(0, 8) ?? null,
                      tools: it.tools.length,
                  }
                : it.kind === "subagent"
                  ? { k: "s", s: it.startIdx, n: it.events.length }
                  : { k: "e", s: it.startIdx, t: it.event.type }
        )
    );

describe("toRenderItemsIncremental 差分模糊（todo #14 双气泡）", () => {
    it("随机事件流：每步增量 === 全量", () => {
        // 固定种子伪随机（可复现）
        let seed = Number(process.env.FUZZ_SEED ?? 42);
        const rnd = (n: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };

        for (let trial = 0; trial < Number(process.env.FUZZ_TRIALS ?? 200); trial++) {
            const events: AgentEvent[] = [];
            let cache: { events: AgentEvent[]; items: RenderItem[] } | undefined;
            let turn = 0;
            for (let step = 0; step < 60; step++) {
                const r = rnd(100);
                if (r < 10) {
                    turn++;
                    events.push(ev("Iteration", `Iteration ${turn}/150`, { turnId: `t${turn}` }));
                } else if (r < 45) {
                    events.push(
                        ev("Thinking", `think-${trial}-${step}-`.slice(0, 6), {
                            turnId: `t${turn || 1}`,
                        })
                    );
                } else if (r < 60) {
                    events.push(
                        ev("AssistantDelta", `ans-${trial}-${step}-`.slice(0, 6), {
                            turnId: `t${turn || 1}`,
                        })
                    );
                } else if (r < 68) {
                    events.push(
                        ev("Assistant", `final-${trial}-${step}`.slice(0, 8), {
                            turnId: `t${turn || 1}`,
                        })
                    );
                } else if (r < 78) {
                    events.push(
                        ev("Tool", "bash", {
                            turnId: `t${turn || 1}`,
                            data: { name: "bash", args: { command: "ls" }, result: "ok" },
                        } as never)
                    );
                } else if (r < 84) {
                    // sub-agent 事件（runId 边界）
                    events.push(ev("Thinking", "sub-think", { turnId: "st", runId: `r${rnd(2)}`, author: "plan" }));
                } else if (r < 90) {
                    events.push(ev("Warning", `warn-${step}`));
                } else if (r < 94) {
                    events.push(ev("User", `user-${step}`));
                } else if (r < 97) {
                    events.push(ev("Usage", "u", { data: { prompt_tokens: 1, completion_tokens: 1 } } as never));
                } else {
                    events.push(ev("Done", "任务完成"));
                }

                const incremental = toRenderItemsIncremental(events, cache);
                cache = { events, items: incremental };
                const full = toRenderItems(events);
                if (sig(incremental) !== sig(full)) {
                    const a = JSON.parse(sig(incremental));
                    const b = JSON.parse(sig(full));
                    for (let i = 0; i < Math.max(a.length, b.length); i++) {
                        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
                            console.error(`trial=${trial} step=${step} len=${events.length} 首个差异 item#${i}`);
                            console.error("incremental:", JSON.stringify(a.slice(Math.max(0, i - 1), i + 2)));
                            console.error("full:      ", JSON.stringify(b.slice(Math.max(0, i - 1), i + 2)));
                            console.error("ALL events:", JSON.stringify(events.map((e) => [e.type.slice(0,4), e.message?.slice(0,8), e.turnId, (e as { runId?: string }).runId?.slice(0,4)])));
                            break;
                        }
                    }
                }
                expect(
                    sig(incremental),
                    `trial=${trial} step=${step} len=${events.length} 增量与全量不一致`
                ).toBe(sig(full));
            }
        }
    });
});
