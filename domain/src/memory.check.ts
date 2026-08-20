// memory 行为检查（tsx + node:assert，无 vitest 依赖）。
// 运行：cd domain && npx tsx src/memory.check.ts
// 验证：scope 隔离 / 两层合并 / 兼容旧 Task/Result 格式 / 窗口截断。
// 用临时 HOME 避免污染真实 ~/.anycode/memory.md。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-mem-home-"));
const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-mem-proj-"));
process.env.HOME = tmpHome; // 必须在动态 import 前设置：workspace.ts 的 REGISTRY_DIR 在加载时求值

const { saveMemory, loadMemory } = await import("./memory");
const { createWorkspace, globalMemoryFile, workspaceConfigDir } = await import(
    "./workspace"
);

const ws = createWorkspace(tmpProject);
const projFile = path.join(workspaceConfigDir(ws), "memory.md");
const globFile = globalMemoryFile();

let pass = 0;
const ok = (name: string) => {
    pass++;
    console.log("  ✓", name);
};

// scope 隔离：project 不写 global
saveMemory(ws, "项目级笔记 A", "project");
assert.ok(fs.existsSync(projFile), "项目 memory.md 应被创建");
assert.ok(!fs.existsSync(globFile), "global memory.md 不应被 project 写入");
ok("AC-003 project 写项目文件，不碰 global");

// 全局层
saveMemory(ws, "全局偏好：用户偏好深色主题", "global");
assert.ok(fs.existsSync(globFile), "global memory.md 应被创建");
assert.ok(
    !fs.readFileSync(projFile, "utf-8").includes("深色主题"),
    "global 内容不应出现在 project 文件"
);
ok("AC-004 global 写全局文件，不串进 project");

// load 合并两层
const loaded = loadMemory(ws);
assert.ok(loaded.includes("项目级笔记 A"), "合并应含项目内容");
assert.ok(loaded.includes("深色主题"), "合并应含全局内容");
assert.ok(loaded.startsWith("\n# Previous context"), "合并应包 Previous context 头");
ok("AC-005 loadMemory 合并全局+项目两层");

// 兼容旧 Task/Result 格式（降级读取）
const oldEntry = `## 2026-01-01T00:00:00.000Z\n\n**Task:** 旧任务\n\n**Result:**\n旧结果\n\n---\n\n`;
fs.appendFileSync(projFile, oldEntry, "utf-8");
const loaded2 = loadMemory(ws);
assert.ok(loaded2.includes("旧任务"), "应能读取旧 Task/Result 条目不报错");
ok("AC-006 兼容旧 Task/Result markdown 格式（降级读取）");

// 窗口：正常量记忆全量返回（把 windowSize 从 1000 调到 4000，默认覆盖常规记忆量）
const bigWs = createWorkspace(fs.mkdtempSync(path.join(os.tmpdir(), "anycode-mem-big-")));
saveMemory(bigWs, "MARKER-CONTENT", "project");
const full = loadMemory(bigWs);
assert.ok(full.includes("MARKER-CONTENT"), "应含写入内容");
assert.ok(full.includes("# Previous context"), "应包 Previous context 头");
ok("loadMemory 正常量全量返回 + Previous context 头");

// save_memory 工具 handler：scope 默认 project + 返回写入信息
const { saveMemoryFunc } = await import("./tools/functions/saveMemory");
const handlerWs = createWorkspace(
    fs.mkdtempSync(path.join(os.tmpdir(), "anycode-mem-handler-"))
);
const fakeCtx = {
    workspace: handlerWs,
    eventStream: { submit: () => {} },
    signal: new AbortController().signal,
} as any;
const r1 = await saveMemoryFunc({ content: "工具写入项目级" }, fakeCtx);
assert.ok(r1.includes("project"), `返回应含 scope=project，实际: ${r1}`);
assert.ok(
    fs.existsSync(path.join(workspaceConfigDir(handlerWs), "memory.md")),
    "工具默认 scope=project 应写项目文件"
);
const r2 = await saveMemoryFunc({ content: "", scope: "project" }, fakeCtx);
assert.ok(r2.startsWith("Error"), "空 content 应返回 Error");
ok("save_memory 工具：scope 默认 project，空 content 报错");
fs.rmSync(handlerWs.rootPath, { recursive: true, force: true });

// 清理
fs.rmSync(tmpHome, { recursive: true, force: true });
fs.rmSync(tmpProject, { recursive: true, force: true });

console.log(`\n${pass}/6 passed`);
