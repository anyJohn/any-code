---
id: SPEC-015
type: spec
parent: RR-009
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: web 展示模型思考过程（reasoning_content）—— 浅色小字体、可折叠、默认折叠、带计时器
---

# SPEC-015: think block 展示

## behaviors
- B-001: callLLM 流式捕获 `delta.reasoning_content`（OpenAI 兼容扩展字段，部分模型如 DeepSeek R1 / 思考型模型在思考阶段输出），经 `onThinkingDelta` 回调上抛
- B-002: core.agentLoop 传 `onThinkingDelta` 给 callLLM，回调内发 `THINKING` 事件，`turnId` 关联同回合（与 ITERATION/ASSISTANT/TOOL 共用）
- B-003: renderItems.groupByTurn 累积同回合 `Thinking` 事件的 message 进 `TurnItem.thinking`
- B-004: TurnBlock 在 assistant 文本前渲染 ThinkingBlock（content=turn.thinking）
- B-005: ThinkingBlock 默认折叠（open=false），浅色小字体（text-[11px] muted）
- B-006: 计时器从首段 thinking 内容到达开始（requestAnimationFrame 每 100ms 量级更新），到 `finished`（同回合已有 assistant）或 30s 停止（DEC-051 防泄漏）
- B-007: 模型不发 reasoning_content（无 Thinking 事件 / thinking 空）→ 不渲染思考块

## constraints
- C-001: reasoning_content 经 delta 扩展字段读取（非 OpenAI 标准字段，需 Record cast 访问）— status: confirmed
- C-002: THINKING 事件复用 turnId，不引入新分组维度 — status: confirmed
- C-003: 计时器上限 30s（DEC-051）— status: confirmed
- C-004: 思考内容不入盘（与 AssistantDelta 同：实时态，仅 THINKING 事件流，messages 不存 reasoning）— status: confirmed

## invariants
- I-001: THINKING 事件仅在流式 provider 且模型发 reasoning_content 时产生；非流式 / 无思考模型无 THINKING 事件
- I-002: ThinkingBlock 渲染当且仅当 turn.thinking 非空

## acceptance_criteria（即测试契约）
- AC-001 (callLLM 捕获 reasoning_content): given 流式 chunk 含 `delta.reasoning_content="think"`, when callLLM(…,onThinkingDelta), then onThinkingDelta 被调以 "think"
- AC-002 (core 发 THINKING 事件): given callLLM mock 调用第 6 参 onThinkingDelta("x"), when agentLoop, then eventStream.submit 收到 type=THINKING 事件（turnId 与同回合一致）
- AC-003 (renderItems 累积 thinking): given 同回合多个 Thinking 事件, when groupByTurn, then TurnItem.thinking = 拼接全文
- AC-004 (ThinkingBlock 默认折叠 + 计时): given ThinkingBlock content 非空, when 渲染, then 默认折叠（内容不可见）；首段到达后 elapsed>0 递增，finished 后停止
- AC-005 (无 thinking 不渲染): given turn 无 Thinking 事件, when groupByTurn, then TurnItem.thinking 为 undefined → ThinkingBlock 不渲染

## decisions (frozen, feature-scoped)
- DEC-051: 计时器上限 30s——防止长思考泄漏计时器资源与 UI 误导；finished（同回合出 assistant）即停
- DEC-052: thinking 渲染在 TurnBlock 内 assistant 文本前（非 inline 混入文本）——思考与正文分层，折叠不打断阅读
- DEC-053: 计时用 requestAnimationFrame 而非 setInterval——与 paint 对齐，后台 tab 自动暂停

## assumptions
- A-001: reasoning_content 为 OpenAI 兼容 API 的扩展字段（DeepSeek R1 / 部分 Qwen 思考模型），非标准 → 仅在流式 delta 探测 — status: inferred
- A-002: 非思考型模型（如 glm-5.2）可能不发 reasoning_content → think block 静默不渲染（B-007）— status: inferred
- A-003: 测试——llm.test 验 reasoning_content→onThinkingDelta；core.test 验 THINKING 事件；renderItems.test 验 thinking 累积；ThinkingBlock 组件测验默认折叠 — status: inferred

## verification（LLM-behavior-dependent 特性，需真 LLM run）
- 真实 LLM run：用思考型模型发一条任务，确认 reasoning_content 流入 → THINKING 事件 → ThinkingBlock 渲染 + 计时器走动
- 当前配置 glm-5.2（dashscope）是否发 reasoning_content 待实测；不发则 B-007 生效（不渲染），需换思考型模型方可端到端验证
