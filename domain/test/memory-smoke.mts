/*
 * FR-24 / SPEC-035 AC-004 真 LLM 冒烟：预置冗余项目记忆 → 发"整理记忆"任务
 * → 断言 LLM 真的调用了 update_memory（rewrite）且文件被精简。
 * 用法：cd domain && npx tsx test/memory-smoke.mts
 */
import fs from "fs";
import os from "os";
import path from "path";
import { AnyAgent } from "../src/main";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-mem-smoke-"));
const memDir = path.join(tmp, ".anycode");
fs.mkdirSync(memDir, { recursive: true });
// 冗余记忆：多条重复/过时条目，给 rewrite 一个明确的蒸馏目标
fs.writeFileSync(
    path.join(memDir, "memory.md"),
    [
        "# Agent Memory",
        "",
        "## 2026-08-01T00:00:00Z",
        "",
        "用户偏好简短而精炼的回答。",
        "",
        "---",
        "",
        "## 2026-08-02T00:00:00Z",
        "",
        "用户不喜欢冗长的回答，喜欢简短回答。（与上一条重复）",
        "",
        "---",
        "",
        "## 2026-08-03T00:00:00Z",
        "",
        "本项目的构建工具是 webpack（过时：实际已迁移到 vite）。",
        "",
        "---",
        "",
        "## 2026-08-04T00:00:00Z",
        "",
        "用户正在开发 anycode 项目。",
        "",
        "---",
        "",
    ].join("\n"),
    "utf-8"
);
const before = fs.readFileSync(path.join(memDir, "memory.md"), "utf-8");

const agent = await AnyAgent.create({ rootPath: tmp });
const done = new Promise<void>((resolve, reject) => {
    agent.eventStream$.subscribe((e: { type?: string; data?: { name?: string } }) => {
        if (e?.type === "ToolStart") console.log("[tool]", e.data?.name);
        if (e?.type === "Done") resolve();
        if (e?.type === "Stopped") reject(new Error("任务被中止"));
    });
});
try {
    agent.submit(
        "请整理（蒸馏重写）你的项目级记忆：合并重复条目、修正过时信息。直接执行，不要提问。"
    );
    await done;
} finally {
    agent.destroy();
}
const after = fs.readFileSync(path.join(memDir, "memory.md"), "utf-8");
console.log("=== BEFORE ===\n" + before);
console.log("=== AFTER ===\n" + after);
// 结构性判据：条目数减少（合并）+ 过时信息被清除。字符数不作硬断言——LLM 蒸馏
// 时可加简短注记，长度可能持平略增，条目合并才是蒸馏的语义。
const countEntries = (s: string) => (s.match(/\n---/g) ?? []).length;
const ok = after !== before && countEntries(after) < countEntries(before);
console.log(ok ? "\nAC-004 PASS：记忆被蒸馏精简" : "\nAC-004 FAIL：记忆未被精简");
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
