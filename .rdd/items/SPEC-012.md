---
id: SPEC-012
type: spec
parent: FE-012
status: approved
created: 2026-08-22
approved: 2026-08-22
persists: permanent
scope: Web 状态/用量监控面板（真实 API usage + USAGE 事件 + GET /api/status + 底部状态条）
---

# SPEC-012: Web 状态/用量监控面板

> 调研结论（claude-hud / Claude Code）：成熟 agent 用**真实 API usage**（LLM 响应里的 usage 对象），不估算。本 SPEC 据此。

## behaviors
- B-001: callLLM 捕获响应 usage（非流式 `resp.usage`；流式加 `stream_options:{include_usage:true}`，末片带 usage），返回 usage 给 agentLoop
- B-002: agentLoop 每轮 callLLM 后发 `USAGE` 事件 `{ prompt_tokens, completion_tokens, contextWindow, turnId }`（SSE 内联，实时）
- B-003: Config 加 per-provider `contextWindow?` 字段（缺省 128000）；`getCurrentProvider()` 含 contextWindow
- B-004: `GET /api/workspaces/:projectKey/status` 返回静态状态 `{ provider, model, contextWindow, skillCount, skillNames, mcpServers: [{name, type}] }`（configured，无活探测）
- B-005: Web 聊天框底部状态条：provider/model + 上下文用量条（prompt_tokens/contextWindow）+ skill 数 + mcp 数；USAGE 事件实时更新用量；GET /status 拉静态（挂载 + 配置保存后）
- B-006: USAGE 事件为实时态（同 ASSISTANT_DELTA），不持久化、不入 messages 数组（避免 usage 字段被下次 callLLM 带给 API）；reload 后用量由首轮流补，model/skill/mcp 由 GET 静态展示

## constraints
- C-001: 真实 API usage（callLLM 捕获，不估算）（DEC-033）— status: confirmed
- C-002: USAGE 事件 SSE 内联（每轮）+ GET /api/status 静态（model/skill/mcp）；无轮询（DEC-034）— status: confirmed
- C-003: 状态条放聊天框底部（输入区下方常驻条）（DEC-035）— status: confirmed
- C-004: MCP 仅 configured 列表（name + type，无活连接探测）（DEC-036）— status: confirmed
- C-005: per-provider `contextWindow?`（缺省 128000）— status: confirmed
- C-006: 流式 callLLM 加 `stream_options:{include_usage:true}` 取末片 usage — status: confirmed
- C-007: USAGE 事件实时态不入 messages 数组（不持久化 v1，避免 usage 字段污染 API 调用）— status: confirmed

## invariants
- I-001: usage 来自真实 LLM API 响应（不估算 chars）— status: confirmed
- I-002: 状态条只读、不抢焦点、常驻 — status: confirmed
- I-003: 无 contextWindow 配置时按 128000 计 — status: confirmed

## acceptance_criteria（即测试契约）
- AC-001 (callLLM 捕获 usage): given callLLM 调用, when 响应含 usage（非流式 resp.usage / 流式末片 usage）, then 捕获 `{prompt_tokens, completion_tokens}` 返回；流式 payload 含 `stream_options.include_usage:true`
- AC-002 (USAGE 事件): given agentLoop 每轮 callLLM 完成, when 有 usage, then 发 `USAGE` 事件 `{prompt_tokens, completion_tokens, contextWindow, turnId}`（SSE 内联）
- AC-003 (contextWindow 配置): given provider 配置含 `contextWindow: 200000`, when 加载, then getCurrentProvider().contextWindow=200000；缺省=128000
- AC-004 (GET /api/status): given workspace config + .anycode/skills/, when GET /api/workspaces/:pk/status, then 返回 {provider, model, contextWindow, skillCount, skillNames, mcpServers:[{name,type}]}（configured mcp）
- AC-005 (底部状态条): given Web 聊天页, when 渲染, then 底部状态条展示 model + 用量条（prompt_tokens/contextWindow）+ skill 数 + mcp 数；收到 USAGE 事件实时更新用量
- AC-006 (USAGE 实时态): given agentLoop 发 USAGE 事件, when 事件入 SSE 流, then web 实时更新用量条；USAGE 不入 messages 数组（不被下次 callLLM 带给 API）。持久化 + 回放 deferred（v1 reload 用量由首轮流补）
- AC-007 (无 contextWindow): given provider 无 contextWindow 字段, when 状态条算用量, then 按 128000 计

## open_questions（非 blocking，deferred 下轮）
- Q-012a usage 持久化 schema（附 assistant 消息 vs 独立条目）— inferred，实现时定
- Q-012b 用量条颜色阈值（绿/黄/红 按 contextWindow 占比）— inferred
- Q-012c 多模型 context window 自动识别（model→window map）— deferred，先靠 config 字段

## decisions (frozen)
- DEC-033: 真实 API usage（callLLM 捕获响应 usage；流式 stream_options.include_usage；对齐 claude-hud / Claude Code 成熟做法，不估算）
- DEC-034: USAGE 事件 SSE 内联（每轮实时）+ GET /api/status 静态（model/skill/mcp）；无轮询
- DEC-035: 状态条放聊天框底部（输入区下方常驻）
- DEC-036: MCP 仅 configured 列表（name+type，无活探测；活连接状态需长寿命 agent，连接持有模型下不适用）

## assumptions
- A-001: callLLM 返回形态改为返回 `{message, usage}` 或在 message 上附 usage；agentLoop 据 usage 发 USAGE 事件 — status: inferred
- A-002: SessionEntry 可附 `usage?` 字段；appendMessage 存储；messagesToEvents 回放 — status: inferred
- A-003: 测试——mock callLLM 返 usage，验 agentLoop 发 USAGE；config.test 验 contextWindow；web 状态条组件测 + /api/status 端点测 — status: inferred

## future (deferred)
- model→contextWindow 自动识别（Q-012c）
- 用量条阈值配色（Q-012b）
- MCP 活连接探测（需长寿命 agent 或按需 probe）→ 非连接持有模型
- cost/速度（如 claude-hud 的 cost/speed）→ 非本 SPEC
