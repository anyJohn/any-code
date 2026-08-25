---
id: SPEC-025
type: spec
parent: RR-019
status: approved
created: 2026-08-25
approved: 2026-08-25
persists: permanent
scope: 上下文压缩（/compact 指令 + 75% 自动压缩）
---

# SPEC-025: 上下文压缩（compact 指令 + 75% 自动）

## behaviors
- B-001: 手动 `/compact [focus]` 指令——用户在 chat 输入 `/compact` 或 `/compact <聚焦文本>`，web 识别 slash 命令 → POST `/api/sessions/:sid/compact` → 服务端压缩 session 并落盘 → 返回压缩前后 token 数 → 前端插 System 事件"已压缩上下文"。不走 /run。
- B-002: 自动压缩——agentLoop 迭代边界（每次 callLLM 前）检查上一轮真实 `usage.prompt_tokens >= 75% * contextWindow` → 触发压缩 → 原地替换 messages → 发 COMPACT 事件 → 继续循环。首迭代无 usage 不会触 75%，无需 tokenizer。
- B-003: 压缩算法——messages=[system, ...rest]，保护 system[0] 不被摘要；rest 切 head(摘要)/tail(保留原文)，tail = 最后 ~6 条消息（配对感知：tail 起始若为 tool 消息，回退切割点把其父 assistant(tool_calls) 一并纳入 tail，保证 tail 内 tool 消息都有配对的 tool_call）。
- B-004: head 序列化成可读文本（user→`[User]: …`、assistant→`[Assistant]: …`+`[tool call]: name(args)`、tool→`[Tool result]: …`），tool 输出截断 ~2000 字符；调 LLM 摘要（同 provider、`tools` 不传、max_tokens ~4096、非流式）产出结构化 Markdown 摘要。
- B-005: 摘要消息存储——role=`user`，内容 = "REFERENCE ONLY" handoff 前缀 + 摘要正文；若 tail[0] 也是 `user`（手动压缩在已结束回合后的典型情形），把摘要合并进 tail[0]（前缀拼接），避免 user→user 邻接。新 messages = [system, summaryMsg?, ...tail]。
- B-006: 落盘——压缩后整体替换 session.messages（原子重写 JSONL：写临时文件 + rename）。原始旧消息不另存（摘要即记录）。
- B-007: 摘要 prompt——结构化模板（目标/关键细节/已完成/进行中/阻塞/下一步/相关文件）+ "保留精确文件路径/符号/命令/错误串/URL/标识符" + 同语言；有旧摘要（前一次压缩留下的 summary 消息）则走 update 模式（合并，新对话覆盖旧）。manual 的 focus 文本注入摘要 prompt。
- B-008: COMPACT 事件——EventType.COMPACT；data 含 beforeTokens/afterTokens/auto/focus。web MessageList 渲染为系统行"已压缩上下文 (X→Y tokens)"。

## constraints
- C-001: 摘要 LLM 调用禁用工具（不传 tools），避免摘要器调工具 — confirmed
- C-002: system prompt 永不摘要 — confirmed
- C-003: 压缩不破坏 tool_call/tool_result 配对（tail 内完整） — confirmed
- C-004: 手动 /compact 与 /run 互斥（single-flight：一方在跑另一方 409） — confirmed
- C-005: 自动压缩用真实 usage.prompt_tokens（非估算），75% 阈值 — confirmed
- C-006: 原始历史不另存 archive（直接 rewrite）；恢复能力作 follow-up — confirmed

## invariants
- I-001: 压缩后 messages[0] 仍为 system（system 重建逻辑不变）
- I-002: tail 内每条 tool 消息都有同在 tail 内的父 assistant(tool_calls)

## acceptance_criteria
- AC-001: `compactMessages(messages, llm)` 单测——构造 [system, user, assistant(tool_calls), tool, user, assistant] 序列，keepN=4 → tail 起始为 tool 时回退切割点纳入父 assistant；head 非空被序列化；输出新数组 = [system, summary(user), ...tail]，summary 含 handoff 前缀；tail 内 tool 消息配对完整。
- AC-002: `estimateTokens` 单测——有 lastUsage 用 prompt_tokens；无则 chars/4 over JSON 兜底。
- AC-003: 自动压缩——agentLoop mock provider：第一轮返回 usage.prompt_tokens=100000、contextWindow=128000（>75%）→ 第二轮 callLLM 前触发 compactMessages（mock 摘要返回固定串）→ messages 被替换、发 COMPACT 事件、lastUsage 重置。断言 messages.length 缩减、COMPACT 事件发出。
- AC-004: 手动 /compact——API 路由单测：POST `/api/sessions/:sid/compact` → 调 agent.compact → session.messages 被原子重写（reload 后 = 压缩后数组）；与 /run 互斥（run 在跑时 409）。
- AC-005: session `replaceMessages` 单测——原子重写：原 5 条 messages 压缩后 2 条，reload 返回 2 条 + meta 保留（title 不丢）。
- AC-006: web `/compact` 命令——useCommand 加 `compact` 内置指令；输入 `/compact focus text` → executeCommand("compact","focus text") → POST compact 端点 → appendSystem 反馈。无 sessionId（新对话无历史）→ appendSystem 提示无可压缩。
- AC-007（真 LLM run）：起 web dev，发一个长任务塞满上下文（或直接 /compact 现有长会话）→ 确认 LLM 真产出结构化摘要、COMPACT 事件到前端、后续对话继续正常（LLM 行为依赖，必须真 run）。

## decisions (frozen)
- DEC-095: 压缩后直接 rewrite session.messages，不另存全量 archive。理由：MVP 最简；摘要即记录。恢复/审计作 follow-up。（反转候选 B）
- DEC-096: 摘要消息 role=`user` + "REFERENCE ONLY" handoff 前缀；tail[0] 为 user 时合并进 tail[0]。理由：OpenAI 兼容、不改 type schema、避免 user→user 邻接。不新增自定义 role（部分 provider 拒非标准 role）。
- DEC-097: 尾部保留按"最后 ~6 条消息"（配对感知），不用 token 预算。理由：简、够用（调研的某业界主流 harness protect_last_n=6 同路）；token 预算 follow-up。
- DEC-098: 自动压缩阈值 = 真实 usage.prompt_tokens >= 75% * contextWindow。理由：信号现成最准；chars/4 仅首迭代兜底（首迭代不会触 75%）。
- DEC-099: manual /compact 支持 focus 文本（注入摘要 prompt）。三工具都有、成本低。
- DEC-100: slash 命令仅识别 /compact 前缀接入现有 useCommand 框架（不另建框架）。
- DEC-101: 摘要 LLM 调用用同 provider/model，禁用工具、max_tokens 4096、非流式（摘要短快，需全文）。
- DEC-102: 手动 /compact 后不刷新前端可见事件列表（appendSystem 反馈即可）；可见历史作为可读转录保留。理由：刷新需重构 history 重载，MVP 不做。后续可加。

## 实现顺序
1. compact.ts（estimateTokens + compactMessages + summarize）+ 单测（AC-001/002）。
2. type.ts 加 COMPACT 事件；core.ts agentLoop auto-compact + onCompact 参数 + 单测（AC-003）。
3. sessionService.replaceMessages + sessionStore 原子重写 + 单测（AC-005）。
4. main.ts compact() 公共方法 + 接 onCompact。
5. web compact API 路由 + singleFlight 共享 + 单测（AC-004）。
6. useCommand 加 /compact + useAgent 透传 currentSessionId（AC-006）。
7. sseEvents/MessageList 渲染 COMPACT 事件。
8. 真 LLM run 验证（AC-007）+ 全量 tsc/test。

## 实现记录（2026-08-25）
- AC-001 ✓：compact.ts `splitForCompact`（配对感知：tail 起始为 tool 回拉父 assistant）+ `compactMessages`（head 序列化→LLM 摘要→[system, summary(user), ...tail]，tail[0] 为 user 时合并避免邻接）。单测 10/10。
- AC-002 ✓：`estimateTokens` 有真实 usage 用 prompt_tokens、否则 chars/4 over JSON 兜底。
- AC-003 ✓：core.ts agentLoop 迭代顶部查 `lastUsage.prompt_tokens >= 0.75 * contextWindow` → compactMessages + 原地替换 + onCompact 落盘 + COMPACT 事件 + lastUsage 重置。core.compact.test 3/3（越阈值触发 / 未越不触发 / 首迭代无 usage 不触发）。
- AC-004 ✓：`/api/sessions/:sid/compact` 路由（singleFlight 与 /run 互斥、404/400/409、create→compact→destroy）。compact-route.test 5/5。
- AC-005 ✓：sessionStore `replaceMessages` 原子重写（写 .tmp + rename，两条 meta 保 createdAt/title，system 不入盘）。sessionStore.test 3/3。baseDir 改惰性读 os.homedir() 便于测试注入 HOME（posix 每次 call 读 HOME env）。
- AC-006 ✓：useCommand 加 `compact` 内置指令（透传 currentSessionId + rootPath）；useAgent 返回 currentSessionId；ChatView 传参；sseEvents AgentEvent 加 "Compact"；renderItems 把 Compact 列为 single 项（否则被 groupByTurn 丢）；MessageList tagClass 加 Compact。useCommand.test 3/3 + renderItems Compact 测试。
- AC-007 ✓：真 LLM run——构造 11 条消息 session，`AnyAgent.compact()` 调真摘要 LLM，产出结构化 Markdown 摘要（目标/关键细节/已完成/进行中/阻塞/下一步/相关文件）+ handoff 前缀；session.jsonl 原子重写；reload 后 11→7 消息（head 5→1 摘要 + tail 6）、messages[0] 为 user 摘要。LLM 行为依赖已用真 run 验证（非 mock）。
- 全量：domain tsc 0 + 108/108；web tsc 0 + 107/107；web `next build` 通过（compact 路由已注册）。
- deferred：原始历史 archive/恢复（DEC-095 follow-up）、token 预算尾部策略（DEC-097 follow-up）、手动压缩后刷新前端可见事件列表（DEC-102 follow-up，现仅 appendSystem 反馈）。
