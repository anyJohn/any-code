---
id: SPEC-027
type: spec
parent: RR-021
status: approved
created: 2026-08-25
approved: 2026-08-25
persists: permanent
scope: ask_question 工具（agent 批量向 human 提问/求选择，阻塞等答案）
---

# SPEC-027: ask_question 工具

## behaviors
- B-001: `ask_question` 工具——schema `questions: Array<{ question: string, header?: string, options?: string[], multiSelect?: boolean }>`（minItems 1, maxItems 5）。options 给出 2-4 选项；无 options→纯自由输入；multiSelect 需配 options；UI 自动加 "Other" 自由输入项（LLM schema 不含）。
- B-002: handler 阻塞 agentLoop——注册 pending 到 `pendingInteractions` 单例 Map（id→{resolve}）→ 发 INTERACTION 事件（data: {id, questions}）→ `Promise.race`([answersPromise, abortPromise, timeoutPromise])。答案到→return 答案串；超时→return best-judgment sentinel；signal abort→return abort sentinel（不 reject，agentLoop 下轮干净 STOPPED）。
- B-003: 答案回灌作 tool_result（非合成 user 消息）。结果串格式：每个问题一行 `Q: <question>\nA: <answer>`（多选 answer = labels 用 ", " 连接；自由输入 = 原文）。
- B-004: 超时——默认 600s（10min）无提交→return "The user did not respond within the time limit. Use your best judgment to proceed."。整个 batch 共一个超时（UI 提交=全答；超时=未提交）。
- B-005: web 回答端点 `POST /api/sessions/:sid/interact` body {interactionId, answers: string[]} → `pendingInteractions.resolve(id, answers)`。answers 与 questions 顺序对齐。
- B-006: web UI——useAgent 收 Interaction 事件→设 pendingInteraction→ChatView 渲染模态（每个问题：header/问题 + 选项按钮 + Other 输入 + 多选 toggle；一个提交按钮送全答）→POST interact→清 pending。模态期间 /run SSE 仍开（agent 阻塞中）。
- B-007: 工具分组——allTools + executeTools 含 ask_question（sub-agent 也可问，INTERACTION 事件 tagged author+runId）；readOnly 不含。
- B-008: systemPrompt 引导——genuinely blocked / 有 trade-off / 非低风险默认时才问；低风险自己定；危险命令确认走权限层勿用此工具。

## constraints
- C-001: ask_question 是常规 LLM 工具（在 tool list，有 schema）— confirmed（业界三工具同构）
- C-002: handler 阻塞 agent loop，不 yield turn — confirmed
- C-003: 答案作 tool_result 回灌，非合成 user 消息 — confirmed
- C-004: stop/abort 时 resolve sentinel（不 reject），保 agentLoop STOPPED 而非 ERROR — confirmed
- C-005: pendingInteractions module 单例（Next 单进程共享，dev HMR 边界可接受） — confirmed
- C-006: 不用于危险命令确认（那是权限层） — confirmed

## invariants
- I-001: pendingInteraction 注册后必然被 resolve/cancel/timeout 三者之一终结（无泄漏）
- I-002: INTERACTION 事件 data.id 与 POST interact 的 interactionId 一致

## acceptance_criteria
- AC-001: schema 单测——ask_question schema 在 allTools+executeTools，不在 readOnly；questions minItems1/maxItems5。
- AC-002: pendingInteractions 单测——register→resolve(id,answers) 唤醒 promise；cancel→resolve abort sentinel；超时→resolve best-judgment sentinel；未知 id resolve 无副作用。
- AC-003: handler 单测（mock eventStream + signal）——发 INTERACTION 事件（data 含 id+questions）；模拟 resolve→return "Q:..\nA:.." 串；模拟 timeout→return best-judgment；模拟 abort→return abort sentinel + 不 reject。
- AC-004: interact 路由单测——POST {interactionId, answers}→pendingInteractions.resolve 被调；返回 200 {status:answered}；未知 id→404。
- AC-005: web——useAgent 收 Interaction 事件设 pendingInteraction；模态渲染问题+选项+Other+多选；提交 POST interact + 清 pending。renderItems/sseEvents 加 Interaction 类型。
- AC-006（真 LLM/UI run）：起 web，发任务让 agent 遇决策→真调 ask_question→模态出现→选/输入→提交→agent 收 tool_result 继续→完成。stop 中止时干净 STOPPED。

## decisions (frozen)
- DEC-109: 批量 1-5 问（schema questions 数组；单问=数组 1）。理由：用户选；业界三工具都支持批量，省一轮往返；UI 多步/全答模态。
- DEC-110: 超时→best-judgment sentinel（默认 600s）。理由：用户选；避 agent 无限挂起；业界 hermes/openclaw 同路。整个 batch 共一超时。
- DEC-111: 答案串格式 `Q: <question>\nA: <answer>` 多选 join ", "。理由：可读 + LLM 易解析；比 JSON 串更直白。
- DEC-112: stop/abort → resolve abort sentinel（不 reject）。理由：reject 会经 toolCall→agentLoop 变 ERROR；resolve sentinel 让 agentLoop 下轮 ctx.signal.aborted→STOPPED，干净。
- DEC-113: pendingInteractions module 单例 Map（非 per-agent）。理由：Next 单进程，/run 与 /interact 共享；id-keyed 解耦 agent 实例。
- DEC-114: 工具名 `ask_question`（用户 todo 措辞）；含 executeTools（sub-agent 可问）。

## 实现顺序
1. pendingInteractions.ts + 单测（AC-002）。
2. type.ts INTERACTION 事件 + ask_question schema + handler + ToolKit 接入 + 单测（AC-001/003）。
3. web interact 路由 + 单测（AC-004）。
4. sseEvents/renderItems + useAgent + ChatView 模态（AC-005）。
5. systemPrompt 引导段（B-008）。
6. 真 LLM/UI run 验证（AC-006）+ 全量 tsc/test。

## 实现记录（2026-08-25）
- AC-001 ✓：ask_question 在 allTools+executeTools、不在 readOnly；schema questions minItems1/maxItems5、options min2/max4。
- AC-002 ✓：pendingInteractions.ts（register/resolve/unregister 单例 Map）单测 4/4（resolve 唤醒 / 未知 id false / unregister 后不唤醒 / 重复 resolve 只首次）。
- AC-003 ✓：askQuestion.ts handler——注册 pending→发 INTERACTION 事件→Promise.race([answers,abort,timeout])；answered→"Q:..\nA:.."；timeout→best-judgment sentinel；abort→abort sentinel（不 reject）。单测 5/5（含 fake-timer 超时 + AbortController 中止）。
- AC-004 ✓：POST /api/sessions/:sid/interact → resolveInteraction；200 answered / 未知 id 404 / 缺参 400 / 非法 json 400。单测 4/4。
- AC-005 ✓：sseEvents 加 "Interaction" 类型；useAgent 拦截 Interaction 事件（不入 events）→ pendingInteraction 状态 + submitInteraction（POST /interact）；ChatView 渲染 InteractionModal（Dialog：每问 header+问题+选项按钮/Other 输入+多选 toggle+提交）；MessageList tagClass 加 Interaction。onClose=stop（中止）。
- AC-006 ✓：真 UI run——发"加日志功能，用 ask_question 问输出文件/控制台+时间戳"→ agent 真调 ask_question（批量 2 问，选项带"(Recommended)"后缀）→ 模态弹出→选"文件"+"是"→提交→agent 收 tool_result 继续→"任务完成"，回复确认两问答案。LLM 行为依赖已用真 run 验证。
- 全量：domain tsc 0 + 119/119（+11 askQuestion/pendingInteractions）；web tsc 0 + 119/119（+4 interact route）。
- deferred：ask_question 超时值可配（现固定 600s）；模态"Other"与选项互斥的视觉态可优化；权限层（危险命令确认，独立于本工具）。

