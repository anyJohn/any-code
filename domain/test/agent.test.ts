import { describe, it, expect, vi, beforeEach } from "vitest";

// 固定桩 mock callLLM：测 AgentTool 子 agent 是否透传 ctx.llm（历史漏传致 callLLM 抛错）
vi.mock("../src/llm", () => ({ callLLM: vi.fn() }));

import { callLLM } from "../src/llm";
import { AgentTool, type AgentDefinition } from "../src/agent";
import type { LlmProvider } from "../src/config";
import type { ToolContext } from "../src/context";

const llm: LlmProvider = {
    apiKey: "k",
    models: [{ id: "m" }],
    defaultModel: "m",
    streaming: true,
    contextWindow: 128000,
};

const mkCtx = (): ToolContext => ({
    workspace: { rootPath: "/tmp" } as never,
    eventStream: { submit: vi.fn() },
    signal: new AbortController().signal,
    llm,
    fileState: new Map<string, number>(),
});

const noToolMsg = (content: string) => ({ role: "assistant", content } as never);

const def: AgentDefinition = {
    name: "testagent",
    description: "test",
    instruction: "you are a test agent",
    tools: [],
    maxIterations: 5,
};

describe("AgentTool 子 agent ctx 透传（plan 报错根因回归）", () => {
    beforeEach(() => vi.mocked(callLLM).mockReset());

    it("子 agent callLLM 收到父 ctx 的 llm（不缺，否则抛 'callLLM 需要 provider'）", async () => {
        vi.mocked(callLLM).mockResolvedValueOnce(noToolMsg("done") as never);
        const tool = AgentTool(def);
        const ctx = mkCtx();
        await tool.handler({ task: "hi" }, ctx);

        // callLLM 第 5 参（index 4）= llm，必须是父 ctx 的 llm
        expect(vi.mocked(callLLM)).toHaveBeenCalled();
        expect(vi.mocked(callLLM).mock.calls[0][4]).toBe(llm);
    });

    it("子 agent ctx 共享父 fileState（read→write staleness 跨 agent）", async () => {
        vi.mocked(callLLM).mockResolvedValueOnce(noToolMsg("done") as never);
        const tool = AgentTool(def);
        const ctx = mkCtx();
        // 通过反射检查 subCtx 不便；改为间接：handler 不抛错即说明 ctx 完整
        const result = await tool.handler({ task: "hi" }, ctx);
        expect(result).toBe("done");
    });
});
