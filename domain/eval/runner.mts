/*
 * eval runner（FR-28）：真 LLM run 任务集 + checker 断言 → eval-report.md。
 * 用法：pnpm eval（或 npx tsx eval/runner.mts [--only <taskId>]）
 * 依赖 ~/.anycode/config.yaml 有可用 provider；无配置时整体 SKIP 并注明。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AnyAgent } from "../src/main";
import { Config } from "../src/config";
import { resolveInteraction } from "../src/pendingInteractions";
import { TASKS } from "./tasks";
import type { AgentEvent } from "../src/type";
import type { EvalResult } from "./types";

const only = process.argv.includes("--only")
    ? process.argv[process.argv.indexOf("--only") + 1]
    : null;

function fmtTokens(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

async function main() {
    // 配置门禁：无可用 provider → 整体 SKIP（不假红）
    let providerName = "";
    let model = "";
    try {
        const cfg = Config.load();
        const p = cfg.getCurrentProvider();
        if (!p.apiKey) throw new Error("apiKey 为空");
        providerName = cfg.default;
        model = p.defaultModel;
    } catch (e) {
        console.log(`SKIP：无可用 LLM 配置（${(e as Error).message}）——eval 需要真 LLM run`);
        return;
    }

    const tasks = only ? TASKS.filter((t) => t.id === only) : TASKS;
    console.log(`eval：${tasks.length} 个任务 | provider=${providerName} model=${model}\n`);

    const results: EvalResult[] = [];
    for (const task of tasks) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), `anycode-eval-${task.id}-`));
        task.setup?.(root);
        const started = Date.now();
        const events: AgentEvent[] = [];
        let interactionAnswered = false;
        const result: EvalResult = {
            id: task.id,
            name: task.name,
            pass: false,
            detail: "",
            durationMs: 0,
            tokens: 0,
        };
        let agent: AnyAgent | null = null;
        try {
            agent = await AnyAgent.create({ rootPath: root });
            const done = new Promise<void>((resolve, reject) => {
                agent!.eventStream$.subscribe((e: AgentEvent) => {
                    events.push(e);
                    // ask_question：自动应答（首个 Interaction 只答一次）
                    if (e.type === "Interaction" && !interactionAnswered) {
                        interactionAnswered = true;
                        const id = (e.data as { id?: string }).id ?? "";
                        setTimeout(() => resolveInteraction(id, ["小明"]), 300);
                    }
                    // 权限 ask：自动放行（eval 观察能力，不测权限层；bash 等非只读工具标准模式必 ask）
                    if (e.type === "PermissionAsk") {
                        const id = (e.data as { id?: string }).id ?? "";
                        setTimeout(() => resolveInteraction(id, ["allow_once"]), 300);
                    }
                    if (e.type === "Done") resolve();
                    if (e.type === "Stopped") reject(new Error("任务被 stop（超时或异常）"));
                    if (e.type === "Error") reject(new Error("任务出错"));
                });
            });
            agent.submit(task.instruction);
            const timeoutMs = task.timeoutMs ?? 120_000;
            await Promise.race([
                done,
                new Promise<never>((_, reject) =>
                    setTimeout(() => {
                        agent?.stop();
                        reject(new Error(`超时（${timeoutMs / 1000}s）`));
                    }, timeoutMs)
                ),
            ]);
            const check = await task.check({
                events,
                workspaceRoot: root,
                interactionAnswer: resolveInteraction,
            });
            result.pass = check.pass;
            result.detail = check.detail;
        } catch (e) {
            // 超时/中断也执行 checker——行为断言基于已收集的事件流
            //（如 plan 任务：子代理被触发并产出即达标，跑不完全程不算退化）
            try {
                const check = await task.check({
                    events,
                    workspaceRoot: root,
                    interactionAnswer: resolveInteraction,
                });
                result.pass = check.pass;
                result.detail = `${check.detail}（${(e as Error).message}）`;
            } catch {
                result.pass = false;
                result.detail = (e as Error).message;
            }
        } finally {
            agent?.destroy();
            result.durationMs = Date.now() - started;
            result.tokens = events
                .filter((e) => e.type === "Usage")
                .reduce(
                    (sum, e) =>
                        sum +
                        (e.data as { prompt_tokens?: number }).prompt_tokens! +
                        (e.data as { completion_tokens?: number }).completion_tokens!,
                    0
                );
            results.push(result);
            fs.rmSync(root, { recursive: true, force: true });
        }
        const mark = result.pass ? "✅" : "❌";
        console.log(
            `${mark} ${task.id}（${(result.durationMs / 1000).toFixed(1)}s, ${fmtTokens(result.tokens)} tok）— ${result.detail}`
        );
    }

    // 报告
    const passed = results.filter((r) => r.pass).length;
    const lines = [
        `# eval report`,
        "",
        `- 时间：${new Date().toISOString()}`,
        `- provider：${providerName} / ${model}`,
        `- 结果：${passed}/${results.length} 通过`,
        "",
        "| 任务 | 结果 | 耗时 | tokens | 说明 |",
        "| --- | --- | --- | --- | --- |",
        ...results.map(
            (r) =>
                `| ${r.id} | ${r.pass ? "✅" : "❌"} | ${(r.durationMs / 1000).toFixed(1)}s | ${fmtTokens(r.tokens)} | ${r.detail.replace(/\|/g, "\\|")} |`
        ),
        "",
    ];
    fs.writeFileSync(path.join(import.meta.dirname, "eval-report.md"), lines.join("\n"), "utf-8");
    console.log(`\n报告：domain/eval/eval-report.md（${passed}/${results.length} 通过）`);
    if (passed < results.length) process.exitCode = 1;
}

void main();
