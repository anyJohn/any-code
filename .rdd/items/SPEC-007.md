---
id: SPEC-007
type: spec
parent: FE-007
status: approved
created: 2026-08-22
approved: 2026-08-22
persists: permanent
scope: 流式输出（token 级，callLLM stream + agentLoop 增量事件 + Web/TUI 增量渲染）
---

# SPEC-007: 流式输出（token 级）

## behaviors
- B-001: `callLLM`（domain/src/llm.ts）改 `stream: true`，消费 `ChatCompletionChunk` 流，累积成完整 assistant message（content 拼接 + tool_calls 按 index 拼装），返回累积后 message；AbortSignal 真打断流
- B-002: `agentLoop`（core.ts）边收 chunk 边发 `ASSISTANT_DELTA` 事件（增量文本 + turnId），流结束发 `ASSISTANT` 整段定稿，再处理 tool_calls
- B-003: 新增 `EventType.ASSISTANT_DELTA`；delta 是实时态不入盘，`ASSISTANT` 整段入盘（DEC-021）
- B-004: 历史回放 `messagesToEvents` 只重建 `ASSISTANT` 整段，不回放 delta
- B-005: abort 时真打断流，已生成内容截断为一条 assistant message，agentLoop 返回 `[stopped]`（终态语义不变）
- B-006: Web `useAgent` 处理 `ASSISTANT_DELTA`（追加到当前 assistant bubble），`ASSISTANT` 定稿；`ChatView` 边收边渲
- B-007: TUI Ink 处理 `ASSISTANT_DELTA`（重渲最后一帧，非追加新 item）

## constraints
- C-001: 新增 `ASSISTANT_DELTA` + `ASSISTANT` 双事件（DEC-020）— status: confirmed
- C-002: 整条写——delta 不入盘，流结束落盘整条 assistant message（DEC-021）— status: confirmed
- C-003: tool_calls 按 index 拼装 OpenAI streaming 分片（DEC-022）— status: confirmed
- C-004: Web + TUI 都做增量渲染（DEC-023）— status: confirmed
- C-005: AbortSignal 真打断流式生成（已有穿透，验证 stream 取消语义）— status: inferred
- C-006: `callLLM` 签名形状保留（返回累积后的 assistant message），内部改流式；agentLoop 控制流不变 — status: confirmed

## invariants
- I-001: 历史回放不回放 delta（只整段）— status: confirmed
- I-002: 流式不改变 agentLoop 终态语义（有 tool_calls→执行，无→返回，abort→stopped，达 maxIter→截断）— status: confirmed（FE-005 已测的控制流保持）
- I-003: delta 事件不入盘（session 文件不膨胀）— status: confirmed

## acceptance_criteria（即测试契约）
- AC-001 (callLLM·stream 累积): given callLLM 调用, when OpenAI 返回 chunk 流, then 消费 chunks 累积成完整 assistant message（content 拼接 + tool_calls 按 index 拼装），返回累积后 message；signature 形状不变
- AC-002 (DELTA 事件): given agentLoop 流式生成中, when 收到含 text delta 的 chunk, then 发 `ASSISTANT_DELTA` 事件 `{ message: deltaText, turnId }`；delta 不落盘
- AC-003 (ASSISTANT 定稿): given 流结束, when 累积完成, then 发 `ASSISTANT` 整段事件 `{ message: fullText, turnId }` + 落盘整条 assistant message（与 FE-005 测的 push-back 语义一致）
- AC-004 (tool_calls 拼装): given 流式响应含 tool_calls 分片（按 index，含 id/function.name 首片 + function.arguments 后续分片）, when 累积, then 按 index 拼装成完整 tool_calls 数组，agentLoop 照常派发执行
- AC-005 (abort 截断): given 流式中 `signal.aborted`, when abort, then 真打断流，已生成内容截断为一条 assistant message，agentLoop 返回 `{ result: "[stopped]", messages }`
- AC-006 (历史回放): given session 持久化消息, when `messagesToEvents` 重建, then 只产 `ASSISTANT` 整段事件，不产 `ASSISTANT_DELTA`
- AC-007 (Web 增量渲染): given Web 收到 `ASSISTANT_DELTA`, when 渲染, then 追加到当前 assistant bubble；收到 `ASSISTANT` 时定稿
- AC-008 (TUI 增量渲染): given TUI 收到 `ASSISTANT_DELTA`, when 渲染, then 重渲最后一帧（非追加新 `<Static>` item）

## open_questions（非 blocking，deferred 下轮）
- Q-004a abort 时是否发 ASSISTANT 整段（已生成内容）——默认不发，直接 STOPPED（inferred）
- Q-004b delta 事件批量化——每 chunk 一事件 vs 攒批（inferred，先每 chunk）
- Q-004c TUI `<Static>` 重渲实现细节（inferred，实现时定）

## decisions (frozen)
- DEC-020: 新增 `ASSISTANT_DELTA`（实时增量，不入盘）+ `ASSISTANT`（整段定稿，入盘）双事件——清晰分离实时态 vs 持久态
- DEC-021: 整条写——delta 不入盘，流结束落盘整条；历史回放只重建整段，session 文件不膨胀
- DEC-022: tool_calls 按 index 拼装 OpenAI streaming 分片——agent 大量用工具场景也享流式
- DEC-023: Web + TUI 都做增量渲染

## assumptions
- A-001: OpenAI SDK streaming chunk 格式 `chunk.choices[0].delta.{content?, tool_calls?: [{index, id?, function:{name?, arguments?}}]}` — status: confirmed（标准 SDK）
- A-002: 测试策略——mock OpenAI SDK stream（vi.mock 返回 fake async iterable of chunks），验 agentLoop 发 DELTA/ASSISTANT + tool_calls 拼装 + abort 截断；AC-007/008 UI 渲染用经验验证（browser / TUI 截图）— status: inferred
- A-003: delta 事件每 chunk 一发（不攒批），前端自行节流 — status: inferred

## future (deferred)
- delta 攒批 / 节流策略 → Q-004b 下轮
- 流式 reasoning/thinking 字段（如模型支持）→ 非本 SPEC
- 流式 token 计数 / 成本展示 → 非本 SPEC
