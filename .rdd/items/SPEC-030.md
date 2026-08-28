---
id: SPEC-030
type: spec
parent: FE-021
status: approved
created: 2026-08-28
approved: 2026-08-28
persists: permanent
scope: FE-021 事件系统重构（typed 可序列化 union + durable 事件日志作 reload 真值，P1-P3）
---

# SPEC-030: 事件系统重构（typed 可序列化 union + durable 事件日志作 reload 真值）

> 场景 B（整体替换）：事件模型 + reload 路径重写，旧路径删除/标 superseded。
> **违反 SPEC-028 I-003**（"SSE 事件流协议不变"）——产品未上线，I-003 superseded（见 I-006）。
> 跨特性架构决策沿用 DEC-007（静态 SPA + hono sidecar）；本 SPEC 是 FE-021 feature-scoped 规格。
> blocking 决策 Q-025..028 已 Human 决（见 decisions）。

## behaviors
- B-001: `AgentEvent` 是 discriminated union，每 variant 有 typed payload（P3 终态）。`Error` variant 携带 `error: ErrorPayload`，`Warning` variant 携带 `error?: ErrorPayload`。`ErrorPayload = { message: string; name: string; stack?: string; cause?: string }`。
- B-002: domain 发出的事件 `data`/`error` 一律是 plain 可序列化对象；raw `Error` 实例不离开 domain 内核（P1）。`serializeError(err): ErrorPayload` 在 `type.ts` 定义，两处 ERROR emit（`main.ts:291` 终态、`core.ts:70` 非终态）统一用它。
- B-003: 终态错误 = `Error`（任务失败，进 `TERMINAL`，结束 run）；非终态错误 = `Warning`（自动压缩失败等，循环继续，不结束 run）。`EventType` 加 `WARNING = "Warning"`。
- B-004: durable 事件集 = `{User, Iteration, Thinking, Assistant, Tool, Error, Warning, Stopped, Done, Compact, Usage}`；ephemeral（live-only，不持久）= `{AssistantDelta, ToolStart, ToolProgress, ToolArgProgress, System, Planning, Interaction}`。`DURABLE_TYPES` 定义在 `domain/src/type.ts`。
- B-005: server `/run` 订阅 `eventStream$`，对每个 live durable event `await service.appendEvent(key, e)`（e 已可序列化，**无 replacer/serializeEvent**）；ephemeral 不持久。复用 `SessionService.appendEvent`（已落 `kind:"event"` JSONL + 原子 touchMeta）。
- B-006: `GET /api/sessions/:id/history` 返回 `{ messages, events, projectKey }`，`events` = 完整 durable 事件序列（有序），作 reload UI 真值。
- B-007: web reload = 重放 `data.events`（`Chat.tsx` `initialEvents = data.events`），**退役 `messagesToEvents` + `mergeEvents`**（删除）。事件位置 by construction（日志有序），非 content-match。
- B-008: `messages` 仍为 LLM context 真值（`callLLM` + `compact` + `onMessage`/`replaceMessages` 持久化语义不变）。events 与 messages 双源各司其职：messages=LLM context，events=UI 真值。
- B-009: durable `Tool` event 持久化存**全量** `result`（与 messages 一致），reload 显示与 live 一致，无截断。
- B-010: server SSE `send(e) = JSON.stringify(e)`，无 custom replacer（P1 后 events 全可序列化）。
- B-011: `EventType` 向后兼容：`export type EventType = AgentEvent["type"]`，旧 `EventType.ERROR` 等引用仍可用（值为 string literal）。
- B-012: sub-agent proxy（`agent.ts`）仍 `parentStream.submit({...e, author, runId})`；e 是 typed union，转发不破坏 variant shape。

## constraints
- C-001: 不引入 Effect / Effect-Schema（plain TS discriminated union）。— confirmed
- C-002: 不改 `messages`/`SessionStore`/`compact`/`callLLM` 的 LLM 语义（messages 仍为 LLM 真值，压缩逻辑/阈值不变）。— confirmed
- C-003: `DURABLE_TYPES` 定义在 domain（`type.ts`），持久化调用在 server（adapter）；domain 不调 `SessionStore`。— confirmed (Q-028)
- C-004: 18 个 `eventStream.submit` 站点（main.ts×5、core.ts×8、toolCall.ts×3、askQuestion.ts×1、agent.ts proxy）迁 typed variant。— confirmed
- C-005: ephemeral 事件不持久、reload 不重建（deltas/progress 丢失可接受，它们是实时 UX）。— confirmed
- C-006: 不多协议（OpenAI-only by design）、不插件化/DI（守 `SessionStore` 接口）。— confirmed
- C-007: P4（pi 风格 `AgentMessage`/`convertToLlm`/`beforeToolCall` hook）不在本 SPEC 范围，另立。— confirmed (Q-025)

## invariants
- I-001: 一个 `Error`/`Warning` 事件的 live shape（SSE 到前端）== 持久化 shape（JSONL → `/history`），含 `message/name/stack/cause`。—— confirmed（消灭 shape 分叉是核心目标）
- I-002: reload 后 errored turn 的 `Error`/`Warning` 事件位置正确（在对应回合，不漂到末尾）——by construction（事件日志有序，非 content-match）。— confirmed
- I-003: 自动压缩失败（`core.ts` 压缩 catch）不再终止 run：发 `Warning`，循环继续，不 finish/destroy。— confirmed（修 latent bug）
- I-004: domain 内核不 import server/web；不碰 `SessionStore` 调用时机。— confirmed
- I-005: reload 后的事件流 = 持久化的 durable 事件序列（重放），不依赖 `messagesToEvents` 反推。— confirmed
- I-006 (superseded): ~~SPEC-028 I-003 "SSE 事件流协议不变（EventType 枚举 / turnId / runId / author）"~~ ——superseded by RR-024（事件协议重构；产品未上线）。新协议见 B-001/B-003/B-011。

## acceptance_criteria（测试契约）
- AC-001 (Error 可序列化): given domain catchError 捕获 `Error err`, when `eventStream.submit` ERROR, then 事件 `data` 是 plain `ErrorPayload`（非 raw `Error` 实例），`JSON.stringify(event)` 含 `message/name/stack/cause`。
- AC-002 (live==persisted shape): given 一个 errored turn, when 取 live SSE 事件 与 `/history` 持久化事件, then `data` shape 逐字段相等（含 `cause`）。
- AC-003 (无 replacer): given server `/run` SSE, when `send(event)`, then 用 `JSON.stringify(event)` 无 custom replacer。
- AC-004 (Warning 非终态): given `core.ts` 自动压缩抛错, when catch, then 发 `Warning` 事件（type=`Warning`，非 `Error`），web `TERMINAL` 不含 `Warning`。
- AC-005 (压缩失败后 run 继续): given mock `compactMessages` 抛错, when agentLoop 跑到压缩 catch, then 发 `Warning` 后循环继续（不 finish/destroy，后续迭代仍调 callLLM）。
- AC-006 (durable 持久): given 一个完整 turn（User→Iteration→Assistant→Tool→Done）, when `/run` 跑完, then session.jsonl 含全部 durable `kind:"event"` 行，ephemeral（AssistantDelta/ToolProgress/ToolStart）不入盘。
- AC-007 (history 返回 events): given 一个持久化 session, when `GET /history`, then 返回 `events[]`（durable 全集，有序）+ `messages[]` + `projectKey`。
- AC-008 (退役重建): given web reload, when `Chat.tsx` 加载, then `initialEvents = data.events`（重放），不调 `messagesToEvents`；`messagesToEvents`/`mergeEvents` 已从代码库删除。
- AC-009 (定位 by construction): given 一个"崩溃后重试成功"session（error turn 后有后续 turn）, when reload, then `Error` 事件在对应回合位置（不在末尾漂移）——由事件日志顺序保证。
- AC-010 (Tool 全量): given 一个带大 `result` 的 `Tool` 事件, when 持久化 + reload, then reload 后 `Tool` event.result == live result（全量，无截断）。
- AC-011 (typed union): given `AgentEvent` 类型, when `cd domain && npx tsc --noEmit`, then 是 discriminated union（per-variant typed payload），无 `data?:any`；18 emit 站点编译通过。
- AC-012 (web 镜像): given web `AgentEvent` 类型, when `cd web && pnpm typecheck`, then 镜像 domain union（无 `data?:unknown`），`MessageList`/`renderItems` 类型安全。
- AC-013 (EventType 兼容): given 旧 `EventType.ERROR` 等引用, when 编译, then 仍可用（`EventType = AgentEvent["type"]`）。
- AC-014 (全绿): given 重构后, when `pnpm -r test` + `pnpm -r typecheck`, then 全绿。

## decisions（feature-scoped, frozen）
- Q-025 → 交付范围：**P1-P3 立项**，P4 另立。
- Q-026 → Tool result：**全量持久**（监控 JSONL 体积后酌情转预览）。
- Q-027 → 错误分层：**纳入 `Warning`**（终态 Error / 非终态 Warning，修压缩失败误终止 bug）。
- Q-028 → 持久归属：**adapter 持久**（server /run `appendEvent`）+ `DURABLE_TYPES` in domain。

## assumptions
- A-001: `Usage` 持久（小，per-turn token 有用）。— inferred（非 blocking，下一轮确认）
- A-002: ephemeral 边界 = `{AssistantDelta, ToolStart, ToolProgress, ToolArgProgress, System, Planning, Interaction}`。— inferred
- A-003: 本特性是事件 MECHANICS 重构（非 LLM 自主行为），AC 用 mocked `callLLM`/`compactMessages` 单测即可验证，无需真 LLM run。— inferred
- A-004: `EventType = AgentEvent["type"]` 保 `EventType.X` 引用可用（渐进迁移）。— inferred
- A-005: `messages` 持久化（`onMessage`/`replaceMessages`）与 LLM context 语义不变。— confirmed

## open_questions（非 blocking，下一轮收敛）
- Q-029: `Usage` 是否持久？（推荐是）
- Q-030: ephemeral 边界最终确认（`System`/`Planning`/`Interaction` 是否持久）。
- Q-031: P3 各 variant payload 字段精修（从现状 `data` shape 提炼，如 `Tool` 的 `{name,args,result}`、`Usage` 的 `{prompt_tokens,completion_tokens,contextWindow}`）。
