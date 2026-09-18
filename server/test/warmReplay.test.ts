import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AnyAgent,
    Config,
    EventStream,
    projectKeyOf,
    type ChatMessage,
} from "@any-code/domain";
import {
    AgentManager,
    getAgentManager,
    TERMINAL,
    type StreamFrame,
} from "../src/agentManager.js";
import { createApp } from "../src/index.js";
import { workspaceJobs } from "../src/shared.js";
import { runningSessions, runningWorkspaces } from "../src/singleFlight.js";

const workspacePath = "/warm-replay-workspace";
const sessionId = "warm-replay-session";
const globals = globalThis as unknown as {
    __anycodeAgentManager?: AgentManager;
};

/** Real event ordering, with task completion controlled by the test and no model or disk access. */
function createFakeAgent() {
    const stream = new EventStream();
    const session = { messages: [] as ChatMessage[] };
    const service = { appendEvent: vi.fn().mockResolvedValue(undefined) };
    stream.submit({ type: "System", message: "cold-start initialization" });
    return {
        eventHistory$: stream.history$,
        eventStream$: stream.event$,
        getSession: () => session,
        getService: () => service,
        getProjectKey: () => projectKeyOf(workspacePath),
        submit: vi.fn((task: string) => {
            session.messages.push({ role: "user", content: task });
            stream.submit({ type: "User", message: task });
        }),
        complete(answer: string) {
            session.messages.push({ role: "assistant", content: answer });
            stream.submit({ type: "Assistant", message: answer });
            stream.submit({ type: "Done", message: "task completed" });
        },
        stop: vi.fn(),
        destroy: vi.fn(() => stream.clear()),
    };
}

/** Like the Web client, stop consuming at the first terminal event. */
function observe(response: Response) {
    const frames: StreamFrame[] = [];
    let ended = false;
    const finished = (async () => {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) return;
                buffer += decoder.decode(value, { stream: true });
                let boundary: number;
                while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                    const block = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    if (!block.startsWith("data: ")) continue;
                    const frame = JSON.parse(block.slice(6)) as StreamFrame;
                    frames.push(frame);
                    if (TERMINAL.has(frame.event.type)) return;
                }
            }
        } finally {
            ended = true;
            reader.releaseLock();
        }
    })();
    return {
        frames,
        finished,
        get ended() {
            return ended;
        },
    };
}

describe("warm agent SSE replay", () => {
    let manager: AgentManager;
    let agent: ReturnType<typeof createFakeAgent>;
    let app: ReturnType<typeof createApp>;
    let requests: AbortController[];

    beforeEach(() => {
        // Only interval timers are faked: SSE keepalives and the warm-cache sweeper.
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
        vi.spyOn(Config, "load").mockReturnValue({
            maxConcurrentRuns: 3,
        } as Config);
        globals.__anycodeAgentManager = new AgentManager();
        manager = getAgentManager();
        agent = createFakeAgent();
        vi.spyOn(AnyAgent, "create").mockResolvedValue(
            agent as unknown as AnyAgent
        );
        app = createApp();
        requests = [];
        runningSessions().clear();
        runningWorkspaces().clear();
    });

    afterEach(() => {
        for (const controller of requests) controller.abort();
        manager.stopAll();
        delete globals.__anycodeAgentManager;
        workspaceJobs.clear();
        runningSessions().clear();
        runningWorkspaces().clear();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    async function run(task: string) {
        const controller = new AbortController();
        requests.push(controller);
        const response = await app.request(`/api/sessions/${sessionId}/run`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task, workspacePath }),
            signal: controller.signal,
        });
        expect(response.status).toBe(200);
        await vi.waitFor(() =>
            expect(agent.submit).toHaveBeenCalledWith(task, undefined)
        );
        return observe(response);
    }

    async function finishFirstRun() {
        const first = await run("first task");
        agent.complete("first answer");
        await first.finished;
        await vi.waitFor(() => expect(manager.get(sessionId)).toBeUndefined());
        return first;
    }

    it("replays cold-start events, then reuses the agent with fresh sequences and intact messages", async () => {
        const first = await finishFirstRun();
        expect(first.frames.map((f) => [f.seq, f.event.type])).toEqual([
            [0, "System"],
            [1, "User"],
            [2, "Assistant"],
            [3, "Done"],
        ]);
        expect(first.frames[0].event.message).toBe("cold-start initialization");
        expect(agent.destroy).not.toHaveBeenCalled();

        const second = await run("second task");
        await vi.waitFor(() => expect(second.frames.length).toBeGreaterThan(0));
        expect(
            second.frames.map((f) => [f.seq, f.event.type, f.event.message])
        ).toEqual([[0, "User", "second task"]]);
        expect(second.ended).toBe(false);
        expect(agent.getSession().messages.map((m) => m.content)).toEqual([
            "first task",
            "first answer",
            "second task",
        ]);
        expect(AnyAgent.create).toHaveBeenCalledOnce();
        expect(manager.get(sessionId)?.agent).toBe(agent);

        agent.complete("second answer");
        await second.finished;
        expect(
            second.frames.map((f) => [f.seq, f.event.type, f.event.message])
        ).toEqual([
            [0, "User", "second task"],
            [1, "Assistant", "second answer"],
            [2, "Done", "task completed"],
        ]);
        expect(second.ended).toBe(true);
    });

    it("reattaches to only the current warm run and waits for its actual terminal event", async () => {
        await finishFirstRun();
        const second = await run("second task");
        const controller = new AbortController();
        requests.push(controller);
        const response = await app.request(
            `/api/sessions/${sessionId}/stream?since=-1`,
            {
                signal: controller.signal,
            }
        );
        expect(response.status).toBe(200);
        const attached = observe(response);
        await vi.waitFor(() =>
            expect(attached.frames.length).toBeGreaterThan(0)
        );
        expect(
            attached.frames.map((f) => [f.seq, f.event.type, f.event.message])
        ).toEqual([[0, "User", "second task"]]);
        expect(attached.ended).toBe(false);

        agent.complete("second answer");
        await Promise.all([second.finished, attached.finished]);
        expect(attached.frames).toEqual(second.frames);
        expect(attached.frames.map((f) => [f.seq, f.event.type])).toEqual([
            [0, "User"],
            [1, "Assistant"],
            [2, "Done"],
        ]);
        expect(AnyAgent.create).toHaveBeenCalledOnce();
    });
});
