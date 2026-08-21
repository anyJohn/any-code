---
id: SPEC-004
type: spec
parent: FE-004
status: approved
created: 2026-08-21
approved: 2026-08-21
persists: permanent
scope: 目标 C（连接持有 agent，去 pool）
---

# SPEC-004: agent 连接持有，去 AgentPool

## behaviors
- B-001: agent 生命周期绑定一个 HTTP 连接（POST /run 的 SSE 流响应）；连接结束（终态事件 Done/Error/Stopped 或客户端断开）= agent destroy
- B-002: 客户端断开连接（关页面/abort）= 服务端 abort 在途 LLM 调用 + destroy agent → 任务真停（符合 ChatGPT 认知）
- B-003: URL 用 sessionId（盘后盾）；`/chat/{sessionId}` 可随时 resume；新对话首条消息创建 session 后前端 replaceState 到 `/chat/{sessionId}`
- B-004: 历史直读盘 `SessionService`，不经 agent/pool；agent 仅活在 /run 期间
- B-005: 停止 = 前端 abort 那个 fetch（AbortController.abort）→ 服务端见 disconnect → stop+destroy

## constraints
- C-001: 传输用 fetch streaming SSE（POST /run 响应 `text/event-stream`，前端 fetch+ReadableStream 解析 `data: ...\n\n`），非 EventSource（EventSource 是 GET-only 无法带 task body）— status: confirmed (DEC-009)
- C-002: 同一 session 同一时刻最多一个 /run 在跑；并发第二个拒绝（防 session.jsonl 交错损坏）— status: confirmed (DEC-011)
- C-003: 新对话 session 在首条消息时创建（两步法：POST /api/sessions 建 session 返回 JSON sessionId，再 POST /api/sessions/:id/run 流；点"新建对话"不调服务端，故不落盘空 session）— status: confirmed (DEC-010)
- C-004: domain 原则不改；仅 destroy() 可选加 abort 在途 LLM — status: confirmed (DEC-007)

## invariants
- I-001: 关页面后任务不在服务端继续跑（无后台 detached task）— status: confirmed
- I-002: 历史读取不需要活 agent（session 在盘上）— status: confirmed
- I-003: 不引入服务端长寿命内存态（无 pool/cache → 无一致性债）— status: confirmed

## acceptance_criteria
- AC-001 (run-SSE): given session S + task, when POST /api/sessions/S/run {task}, then 响应 text/event-stream，事件按序泵出，终态(Done/Error/Stopped)后流关闭 + agent destroy
- AC-002 (close=stop): given /run 进行中, when 客户端断开(关页面/abort), then 服务端 abort 在途 LLM + destroy agent，任务不在后台继续
- AC-003 (sessionId URL): given 已有 session S, when 访问 /chat/S, then resume 历史直读盘显示，无"已失效"（即使服务重启）
- AC-004 (new chat): given 新对话(前端 /chat/new 不调服务端), when 首条消息, then 先 POST /api/sessions {workspacePath, task} 返回 JSON {sessionId} → 前端 replaceState /chat/{sessionId} → 再 POST /api/sessions/:sessionId/run 流响应。不落盘空 session（不发消息不建）。
- AC-005 (history): given session S, when GET /api/sessions/S/history, then 返回盘上 messages，不需活 agent
- AC-006 (stop): given /run 进行中, when 前端点停止(abort fetch), then 服务端停 LLM + 流收 STOPPED（或前端直接 abort 不再收）
- AC-007 (concurrent): given session S 已有一个 /run 在跑, when 第二个 /run 并发到达, then 返 409 拒绝（不并发写盘）。未来扩展走 Agent fork（分支成新 session），非同 session 并发。

## open_questions
（全部已决策，见 decisions）

## future (deferred)
- Agent fork：从某 session 某轮分支出新 session（树状对话），替代"同 session 并发"的诉求。本轮不做，记为扩展方向。

## decisions (frozen)
- DEC-007: agent task 级生命周期，连接持有，关页面=停（ChatGPT 认知）。去 pool。
- DEC-008: URL 用 sessionId（盘后盾）；历史直读盘不过 agent；旧 agentId URL 标 superseded（无盘后盾，不可恢复）。
- DEC-009: 传输 fetch streaming SSE（POST /run 响应 text/event-stream）；EventSource→fetch+ReadableStream；stop=abort fetch。
- DEC-010: 两步法建 session——POST /api/sessions 建 session 返回 JSON sessionId，POST /api/sessions/:id/run 流响应。解耦"建 session"与"跑任务"，留扩展性（将来 session 元数据/多次 run/配置有处放）。不落盘空 session。
- DEC-011: 不允许同 session 并发 /run——第二个返 409。并发诉求未来走 Agent fork（分支新 session）。

## assumptions
- A-001: agent 重建（每 task resume session）开销可接受（AnyAgent 轻量，系统提示词每次重建 OK）— status: inferred
- A-002: 本地单用户场景，SSE 断=停可接受（无跨重连存活需求）— status: confirmed
