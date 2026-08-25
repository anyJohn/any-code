import { randomUUID } from "node:crypto";
import type { ToolContext } from "../../context";
import { EventType } from "../../type";
import {
    registerInteraction,
    unregisterInteraction,
} from "../../pendingInteractions";

/**
 * ask_question handler：阻塞 agent loop 等 human 答案。
 *
 * 注册 pending → 发 INTERACTION 事件 → Promise.race([answers, abort, timeout])。
 *  - answers 到：return "Q: <question>\nA: <answer>" 多行（多选 join ", "）
 *  - 超时：return best-judgment sentinel（LLM 自行定夺继续）
 *  - signal abort（stop）：return abort sentinel（不 reject——agentLoop 下轮 ctx.signal.aborted→STOPPED，干净）
 * 答案作 tool_result 回灌（非合成 user 消息）。
 */

export const ASK_TIMEOUT_MS = 10 * 60 * 1000;
const TIMEOUT_SENTINEL =
    "The user did not respond within the time limit. Use your best judgment to proceed.";
const ABORT_SENTINEL = "[stopped: user stopped before answering]";

interface AskQuestionItem {
    question: string;
    header?: string;
    options?: string[];
    multiSelect?: boolean;
}

function formatAnswers(questions: AskQuestionItem[], answers: string[]): string {
    return questions
        .map((q, i) => `Q: ${q.question}\nA: ${answers[i] ?? "(no answer)"}`)
        .join("\n\n");
}

export async function askQuestionFunc(
    args: unknown,
    ctx: ToolContext
): Promise<string> {
    const items = (args as { questions?: AskQuestionItem[] }).questions ?? [];
    if (items.length === 0) return "[Error] ask_question requires at least one question";

    const id = randomUUID();
    const questions = items.map((q) => ({
        question: q.question,
        header: q.header,
        options: q.options,
        multiSelect: q.multiSelect,
    }));

    const answersPromise = new Promise<string[]>((resolve) => {
        registerInteraction(id, { resolve });
    });
    const abortPromise = new Promise<"aborted">((resolve) => {
        if (ctx.signal.aborted) return resolve("aborted");
        ctx.signal.addEventListener("abort", () => resolve("aborted"), {
            once: true,
        });
    });
    const timeoutPromise = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), ASK_TIMEOUT_MS);
    });

    // 发 INTERACTION 事件（web 据此弹模态）
    ctx.eventStream.submit({
        type: EventType.INTERACTION,
        message: `ask_question: ${questions.length} question(s)`,
        data: { id, questions },
    });

    let outcome: { kind: "answered"; answers: string[] } | { kind: "timeout" } | { kind: "aborted" };
    const raced = await Promise.race([
        answersPromise.then((answers) => ({ kind: "answered" as const, answers })),
        abortPromise.then(() => ({ kind: "aborted" as const })),
        timeoutPromise.then(() => ({ kind: "timeout" as const })),
    ]);
    outcome = raced;

    // 落败方（timeout/abort）清自己的注册，防泄漏 + 防迟到的 POST 唤醒 stale resolve
    if (outcome.kind !== "answered") {
        unregisterInteraction(id);
    }

    if (outcome.kind === "answered") return formatAnswers(questions, outcome.answers);
    if (outcome.kind === "timeout") return TIMEOUT_SENTINEL;
    return ABORT_SENTINEL;
}
