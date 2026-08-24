---
id: SPEC-018
type: spec
parent: RR-012
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: 长 bash 执行期间界面持续反馈——流式 stdout + TOOL_START/PROGRESS + typing 修正 + SSE keepalive
---

# SPEC-018: 长 bash 执行无响应优化（流式治本）

## behaviors
- B-001: bash.ts 改用 `spawn` 监听 stdout/stderr `data` 事件，逐 chunk 经 `ctx.eventStream` 发 `TOOL_PROGRESS` 事件
- B-002: toolCall.ts 在 `await tool.handler` 前发 `TOOL_START` 事件（data:{name, args}）
- B-003: handler resolve 后发 `TOOL` 事件（完整 result，现状不变）
- B-004: EventType 加 `TOOL_START` / `TOOL_PROGRESS`
- B-005: SSE run/route 加 keepalive（comment frame `: keepalive\n\n`，防静默期连接断/无反馈）
- B-006: showTyping 判定修正——"上一条 User 或带 tool_calls 的 Assistant 之后无对应 Tool 事件" → 工具运行期持续显示指示
- B-007: 前端 renderItems 识别 `TOOL_START`/`TOOL_PROGRESS` 渲染"进行中"tool 卡片（实时态，实时显示累积 stdout）

## constraints
- C-001: `TOOL_PROGRESS` 实时增量不入盘（仅 SSE 流）；`TOOL` 末事件 result 入盘语义不变 — status: confirmed
- C-002: 流式不改变 tool 最终 result 落盘（仍整段 result） — status: confirmed
- C-003: keepalive 用 SSE comment frame，前端 parseSSE 忽略非 `data:` 行（天然兼容） — status: confirmed
- C-004: `TOOL_START` 仅实时态不入盘（与 TOOL_PROGRESS 同） — status: confirmed

## invariants
- I-001: 工具执行期间前端必收到事件（TOOL_START 立即 + TOOL_PROGRESS 持续或 keepalive 兜底），不再有 >15s 静默
- I-002: bash 超时语义不变（120s），超时仍返回截断 result

## acceptance_criteria（即测试契约）
- AC-001 (bash 流式): given bash 执行 `echo a; echo b`, when spawn, then 逐行 stdout 经 TOOL_PROGRESS 发出（data=chunk）
- AC-002 (TOOL_START): given toolCall 执行某 tool, when handler 调用前, then 发 TOOL_START 事件（data={name,args}）
- AC-003 (前端进行中卡片): given 收到 TOOL_START+TOOL_PROGRESS, when renderItems, then 进行中 tool 卡片实时累积显示 stdout
- AC-004 (typing 修正): given Assistant 带 tool_calls 后无对应 Tool 事件, when pending, then 持续显示指示（不提前消失）
- AC-005 (SSE keepalive): given 静默期, when >N 秒无事件, then 注入 keepalive comment frame（连接不断）
- AC-006 (不落盘): given TOOL_PROGRESS/TOOL_START 事件, when 落盘, then 不入 JSONL（仅 TOOL 末事件 result 入盘）
- AC-007 (真 LLM run): given 跑长 bash `for i in 1..5; do echo $i; sleep 2; done`, when 执行, then 前端逐行实时见 1..5（非跑完一次性）

## decisions (frozen, feature-scoped)
- DEC-058: 优化力度 = 一步到位流式 stdout 治本（用户决策）
- DEC-059: bash 改 spawn 监听 stdout/stderr data 事件逐 chunk 发 TOOL_PROGRESS
- DEC-060: 新增 EventType TOOL_START/TOOL_PROGRESS（不复用，语义清晰）
- DEC-061: SSE keepalive 仍加（防命令无输出期静默，如 `sleep 30`；keepalive 兜底）
- DEC-062: showTyping 修正判定基线——"上一条 User 或带 tool_calls 的 Assistant 之后无对应 Tool"

## assumptions
- A-001: spawn 的 stdout/stderr chunk 边界不保证按行，前端按 chunk 累积拼接显示即可 — status: inferred
- A-002: 进行中 tool 卡片复用 ToolRow 折叠形态 + 实时累积 progress 文本 — status: inferred

## modifies
- SPEC-015 B-007 与本 spec 无冲突（thinking 仍实时态）
