---
id: SPEC-017
type: spec
parent: RR-011
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: 思考内容（reasoning_content）随 session 落盘，切换/刷新后回放仍渲染 ThinkingBlock
---

# SPEC-017: 思考内容落盘（_meta sidecar）

## behaviors
- B-001: llm.streamCall 累积 `delta.reasoning_content` 增量成完整文本（现仅回调不累积）
- B-002: 返回的 assistant message 挂 `_meta: { reasoning: string }`（命名空间化非标准字段，随 message entry 落盘）
- B-003: callLLM 入口统一剥离 `_meta`——发给 provider 的 messages 不含 `_meta`（防 provider 400）
- B-004: /history 返回的 messages 透传 `_meta`（HistoryMessage 加 `_meta?: { reasoning?: string }`）
- B-005: web messagesToEvents assistant 分支——若 `m._meta?.reasoning` 则先产 `Thinking` 事件（同 turnId），再产 ASSISTANT
- B-006: 回放后 groupByTurn 累积 Thinking → TurnItem.thinking → ThinkingBlock 渲染

## constraints
- C-001: 推翻 SPEC-015 C-004（思考不入盘）→ 思考随 assistant message `_meta.reasoning` 落盘 — status: confirmed
- C-002: `_meta` 在 callLLM 入口剥离，发给 provider 的 messages 绝不含 `_meta` — status: confirmed
- C-003: 实时 THINKING delta 事件仍不入盘（仅走 SSE），回放靠 `_meta.reasoning` 重建（与 Q3 决策一致）— status: confirmed
- C-004: 历史 session（已存无 `_meta`）回放时不产 Thinking（向后兼容）— status: confirmed

## invariants
- I-001: 同一 assistant message 的 reasoning 与其 content 在回放时同回合、顺序一致（reasoning 在 content 前）
- I-002: 发给任何 LLM provider 的 messages 不含 `_meta` 字段

## acceptance_criteria（即测试契约）
- AC-001 (streamCall 累积 + _meta 挂载): given 流式 chunk 含 reasoning_content "a"/"b", when callLLM, then 返回 message.\_meta.reasoning = "ab"
- AC-002 (callLLM 入口剥离 _meta): given messages 含 `_meta`, when callLLM 发请求, then payload.messages 不含 `_meta`
- AC-003 (messagesToEvents 重建 Thinking): given history assistant 带 `_meta.reasoning`, when messagesToEvents, then 产 Thinking 事件（在 ASSISTANT 前，同 turnId，message=reasoning 全文）
- AC-004 (回放渲染): given 切换 session 回放带 reasoning 的 history, when 渲染, then ThinkingBlock 显示 reasoning
- AC-005 (向后兼容): given 历史 assistant 无 `_meta`, when messagesToEvents, then 不产 Thinking
- AC-006 (真 LLM run): given 思考型模型跑一轮产生 reasoning 落盘, when 切换 session 回放, then 仍见 thinking

## decisions (frozen, feature-scoped)
- DEC-055: 落盘方案 = `_meta` sidecar（message 上 `_meta:{reasoning}`，命名空间化显式表私有，避免和 provider 的 reasoning_content delta 字段同名混淆）
- DEC-056: LLM 入口剥离点在 callLLM（最内层，防别处直接传 messages 给 provider 时漏剥）
- DEC-057: 实时 THINKING delta 不入盘，回放靠 `_meta.reasoning` 重建（与 AssistantDelta 实时态不入盘一致）

## assumptions
- A-001: `_meta` 为非标准字段，TypeScript 上以扩展接口承载（ChatMessage 是联合类型，加 `_meta?` 需 cast 或扩展）— status: inferred
- A-002: thinking 回放与实时流同形——均产 Thinking 事件供 groupByTurn 累积，ThinkingBlock 无需区分来源 — status: inferred

## modifies
- SPEC-015: C-004 由 confirmed 改 superseded；B-007 补"回放也渲染"（由 SPEC-017 B-006 承接）
