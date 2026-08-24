---
id: SPEC-022
type: spec
parent: RR-016
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: write 工具端到端重构——流式 arguments 心跳 + TOOL args 截断 + 原子写 + staleness + edit 引导
---

# SPEC-022: write 工具端到端重构

## behaviors
- B-001: EventType 加 TOOL_ARG_PROGRESS
- B-002: streamCall 累积 tool_call.arguments 时每 2KB 发 TOOL_ARG_PROGRESS 事件（data:{bytes 累计, name?}，不含 content 片段）
- B-003: core.ts 传 onToolArgProgress 回调 → submit TOOL_ARG_PROGRESS 事件（turnId 关联）
- B-004: toolCall.ts TOOL/TOOL_START 事件 data.args 对长字符串值截断（>500 字符 → 前 500 + "[truncated, N total]"）
- B-005: write.ts 改原子写（temp file + rename + sync，同文件系统原子发布，崩溃不留半写）
- B-006: staleness——ToolContext 加 fileState（path→read mtime）；read 记录；write/edit 写前对比 mtime，漂移只警告（挂 result），不阻断
- B-007: system prompt 强化——小改动优先 edit/str_replace，write 仅整文件创建/大改
- B-008: web 收到 TOOL_ARG_PROGRESS → "正在生成 [tool]… N bytes" 指示器（arguments 流式期间不冻屏）

## constraints
- C-001: 心跳只带 bytes + name，绝不带 content 片段（防 SSE 大 payload） — status: confirmed（DEC-076）
- C-002: TOOL 事件 args content 截断到 500 + 总长提示 — status: confirmed（DEC-077）
- C-003: 原子写 temp+rename，同文件系统 — status: confirmed（DEC-078）
- C-004: staleness 非阻断，只警告 — status: confirmed（DEC-079）
- C-005: edit 优先为引导非强制 — status: confirmed（DEC-080）

## invariants
- I-001: 大 write 流式期间前端必有进度指示（心跳或 keepalive），不再静默冻屏
- I-002: TOOL 事件 data.args 任一字符串值 ≤ 500 + 截断提示

## acceptance_criteria
- AC-001 (心跳): given tool_call arguments 流式 > 2KB, when streamCall 累积, then 每 2KB 发 TOOL_ARG_PROGRESS（data.bytes 累计，无 content）
- AC-002 (args 截断): given write content 10000 字符, when toolCall 发 TOOL, then data.args.content = 前 500 + "[truncated, 10000 total]"
- AC-003 (原子写): given write, when 执行, then temp+rename（原文件在 rename 前不变）
- AC-004 (staleness): given read 后文件被外部改 mtime, when write, then result 含 staleness 警告（仍写入）
- AC-005 (edit 引导): system prompt 含"小改动优先 edit"
- AC-006 (web 指示器): given TOOL_ARG_PROGRESS 事件, when 渲染, then 显示"正在生成… N bytes"（不冻屏）
- AC-007 (真 run): given 50KB+ write, when 执行, then web 流式期间见进度指示，不卡死

## decisions (frozen)
- DEC-076: 心跳每 2KB 发 TOOL_ARG_PROGRESS（只 bytes+name，无 content）
- DEC-077: TOOL args 字符串值 >500 截断（前 500 + "[truncated, N total]"）
- DEC-078: 原子写 temp+rename+sync
- DEC-079: staleness mtime 对比，警告不阻断
- DEC-080: edit 优先 system prompt 引导

## assumptions
- A-001: streamCall 按 tool_call index 累积 arguments，首片含 id+name — status: inferred
- A-002: 截断 args 不影响 agent 逻辑（agent 看 result 不看 args 事件） — status: inferred
