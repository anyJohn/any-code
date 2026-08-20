---
id: SPEC-003
type: spec
parent: FE-003
status: approved
created: 2026-08-20
approved: 2026-08-20
persists: permanent
scope: FE-003 Memory 高质量化（save_memory 工具 US-007 + 两层分层 US-008 + 读取策略 US-009）
---

# SPEC-003: Memory LLM 介入 + 分层

## behaviors
- B-001: agentLoop 内 LLM 可调用 `save_memory` 工具写入记忆，自主决定记什么、记到 project 还是 global（DEC-005/006）
- B-002: 撤掉 `main.ts:234` 无条件 `saveMemory`，记忆只在 LLM 主动调用工具时产生（对比现状无脑全记）
- B-003: `loadMemory` 合并全局 + 项目两层注入系统提示词（`main.ts:252` getSystemMessage）
- B-004: `save_memory` 工具签名 `({ content: string, scope: "project" | "global" })`

## constraints
- C-001: 新增工具注册进 ToolKit（`schema.ts` + `functions/saveMemory.ts`），不碰 `core.ts` 推理逻辑（DEC-005）— status: confirmed
- C-002: 全局路径 `~/.anycode/memory.md`，项目 `<root>/.anycode/memory.md`，两层独立（DEC-006）— status: confirmed
- C-003: 兼容旧项目级 memory.md（格式若保持 markdown 则降级读取，若改结构化则需迁移）— status: confirmed
- C-004: 记忆格式保持 markdown（`## 时间戳 + content`），不结构化；读取 = 全局+项目合并 + 滑动窗口调大（4000 字符），不引入 RAG — status: confirmed

## invariants
- I-001: LLM 不主动调用 save_memory 时，不产生任何记忆写入 — status: confirmed
- I-002: save_memory 的 scope 严格隔离——project 不写 global，反之亦然 — status: confirmed
- I-003: loadMemory 注入系统提示词时，全局 + 项目两层都加载（合并）— status: confirmed
- I-004: 不破坏 agentLoop 现有推理循环（工具经 ToolKit 注入）— status: confirmed

## acceptance_criteria
- AC-001 (工具调用): given agent 处理任务, when LLM 判断某信息值得记, then 调用 save_memory({content, scope}) 工具, 写入对应层 memory.md
- AC-002 (不主动不记): given LLM 未调用 save_memory, when 任务结束, then 不写任何 memory（对比现状无条件 save）
- AC-003 (scope 隔离): given save_memory scope=project, when 写入, then 写 <root>/.anycode/memory.md，不碰 ~/.anycode/memory.md
- AC-004 (全局层): given save_memory scope=global, when 写入, then 写 ~/.anycode/memory.md
- AC-005 (load 合并): given getSystemMessage, when 加载 memory, then 全局 + 项目两层合并注入系统提示词
- AC-006 (兼容旧): given 旧 memory.md, when loadMemory, then 正常降级读取不报错
- AC-007 (闲聊不记): given 用户闲聊（如"打个招呼"）, when LLM 判断无需记, then 不调 save_memory，不写入

## open_questions
（全部已决策，见 decisions）

## decisions (feature-scoped, frozen)
- Q-012 → 不结构化，读取 = 合并两层 + 滑动窗口调大（4000 字符），不引入 RAG
- Q-013 → 格式保持 markdown（兼容旧 memory.md，降级读取）

## assumptions
- A-001: 格式保持 markdown，工具传 content 字符串 — status: confirmed
- A-002: 读取策略 = 合并两层 + 滑动窗口调大 — status: confirmed
