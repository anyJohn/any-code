import fs from "node:fs";
import path from "node:path";
import { finalAssistant, toolsUsed, type EvalTask } from "../types";

/**
 * eval 任务集（FR-28）：真 LLM run + checker 确定性断言。
 * 每个任务在独立 temp workspace 中运行。
 */
export const TASKS: EvalTask[] = [
    {
        id: "read-answer",
        name: "读文件并回答内容",
        instruction:
            "读取 secret.txt（用 read 工具），把文件里的暗号原样告诉我。不要执行其他操作。",
        async check({ events, workspaceRoot }) {
            const text = finalAssistant(events);
            const pass = text.includes("蓝鲸42") && toolsUsed(events).has("read");
            void workspaceRoot;
            return {
                pass,
                detail: pass ? "回答含暗号且调用了 read" : `assistant:「${text.slice(0, 80)}」 tools:${[...toolsUsed(events)]}`,
            };
        },
        setup(root: string) {
            fs.writeFileSync(path.join(root, "secret.txt"), "暗号-蓝鲸42\n", "utf-8");
        },
    },
    {
        id: "edit-precise",
        name: "edit 精确修改文件",
        instruction:
            "把 config.txt 里的主题色从 red 改成 blue（用 edit 工具做精确替换，不要重写整个文件）。",
        timeoutMs: 150_000,
        async check({ events, workspaceRoot }) {
            const content = fs.readFileSync(path.join(workspaceRoot, "config.txt"), "utf-8");
            const pass = content.includes("blue") && !content.includes("red") && toolsUsed(events).has("edit");
            return {
                pass,
                detail: pass ? "文件已改且走 edit 工具" : `文件内容:「${content.slice(0, 60)}」 tools:${[...toolsUsed(events)]}`,
            };
        },
        setup(root: string) {
            fs.writeFileSync(path.join(root, "config.txt"), "theme:\n  color: red\n", "utf-8");
        },
    },
    {
        id: "write-snapshot",
        name: "写文件产生快照",
        instruction: "创建 notes.md，内容为一行文字：hello-eval。",
        async check({ events, workspaceRoot }) {
            const p = path.join(workspaceRoot, "notes.md");
            const exists = fs.existsSync(p) && fs.readFileSync(p, "utf-8").includes("hello-eval");
            return {
                pass: exists,
                detail: exists ? "notes.md 落盘" : "notes.md 未创建或缺内容",
            };
        },
    },
    {
        id: "memory-write",
        name: "update_memory 主动记忆",
        instruction:
            "请记住一件事（用记忆工具，scope 保持默认）：用户最喜欢的水果是榴莲。记完告诉我记好了。",
        timeoutMs: 150_000,
        async check({ events, workspaceRoot }) {
            const memFile = path.join(workspaceRoot, ".anycode", "memory.md");
            const saved = fs.existsSync(memFile) && fs.readFileSync(memFile, "utf-8").includes("榴莲");
            return {
                pass: saved,
                detail: saved ? "memory.md 含新记忆" : `memory.md:「${fs.existsSync(memFile) ? "在但无内容" : "不存在"}」 tools:${[...toolsUsed(events)]}`,
            };
        },
    },
    {
        id: "ask-interaction",
        name: "ask_question 交互问答",
        instruction:
            "你不知道我的名字。用 ask_question 工具问我「你叫什么名字」（一个问题，free-text 即可），拿到答案后告诉我。",
        timeoutMs: 180_000,
        async check({ events, interactionAnswer, workspaceRoot }) {
            void workspaceRoot;
            // runner 在收到 Interaction 事件时调 interactionAnswer 自动应答
            const text = finalAssistant(events);
            const asked = events.some((e) => e.type === "Interaction");
            const pass = asked && text.toLowerCase().includes("小明");
            return {
                pass,
                detail: pass ? "问了并答对" : asked ? `问了但回答:「${text.slice(0, 60)}」` : "未发起提问",
            };
        },
    },
    {
        id: "bash-job",
        name: "bash 后台任务 + job_output",
        instruction:
            "用 bash 的后台运行功能执行 `sleep 1 && echo bg-done-7788`，等它完成后用 job_output 读取输出，把 echo 的内容告诉我。",
        timeoutMs: 180_000,
        async check({ events }) {
            const text = finalAssistant(events);
            const pass = text.includes("bg-done-7788");
            return {
                pass,
                detail: pass ? "后台输出被读回" : `assistant:「${text.slice(0, 80)}」`,
            };
        },
    },
    {
        id: "plan-subagent",
        name: "plan 子代理拆解",
        instruction:
            "必须使用 plan 工具：拆解「给一个 TODO 应用加上拖拽排序功能」的实施步骤，然后把拆解结果摘要告诉我。不要开始实施。",
        timeoutMs: 240_000,
        async check({ events }) {
            const subagent = events.some((e) => e.runId);
            const text = finalAssistant(events);
            const pass = subagent;
            return {
                pass,
                detail: pass ? "plan sub-agent 已触发" : `无 sub-agent 事件；assistant:「${text.slice(0, 60)}」`,
            };
        },
    },
];
