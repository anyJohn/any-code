---
id: SPEC-019
type: spec
parent: RR-013
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: contextWindow 自动探测 + 取最小 + 用户可配更小
---

# SPEC-019: contextWindow 自动探测 + 取最小

## behaviors
- B-001: LlmProvider.contextWindow 改 optional（undefined = 用户未配）；normalize 不再给缺省 128000
- B-002: detectContextWindow(provider) async：调 GET /models/{model}（或 list），取返回的 context_window / context_length 字段；无字段/错误 → undefined；带 module-level 缓存（key=baseURL|model，TTL 内不重复网络）
- B-003: resolveContextWindow(provider, detected?) 纯函数：candidates = [detected, 模型表值, provider.contextWindow] 去空 → Math.min；全空 → 128000
- B-004: AnyAgent.initConfig 改 async：Config.load 后探测当前 provider → resolve → 写回 provider.contextWindow（resolved number）
- B-005: status 端点返回 resolveContextWindow(provider)（不探测，用表+用户+128000，避免每次 status 网络调用）
- B-006: core.ts Usage 事件 data.contextWindow 用 resolved provider.contextWindow（initConfig 后已是 resolved）
- B-007: settings 表单加 contextWindow 数字输入（空=auto，不配）；fromResponse/toConfigShape 保留 contextWindow，保存不丢失

## constraints
- C-001: 探测值与用户配置取 min——用户配更小则用用户值，防超真实窗口 — status: confirmed（DEC-063）
- C-002: contextWindow optional——undefined 不参与 min 截断（避免缺省值误截断探测大值）— status: confirmed（DEC-064）
- C-003: 探测失败（无字段/网络错/provider 不支持）静默回退，不阻断 agent 启动 — status: confirmed
- C-004: 内置模型表仅含确信值，probe 与 user 优先于表 — status: confirmed（DEC-065）

## invariants
- I-001: resolved contextWindow 恒为 number（resolve 兜底 128000）
- I-002: 探测值与用户配置同时存在时，resolved ≤ min(探测, 用户)（防超真实窗口）

## acceptance_criteria（即测试契约）
- AC-001 (resolve min): given detected=200000 + user=50000, when resolve, then 50000；detected=200000 无 user → 200000；user=50000 无 detected → 50000；全无 → 128000
- AC-002 (detect): given /models 返回 context_window=200000, when detect, then 200000；无 context 字段 → undefined；抛错 → undefined；命中缓存不重复网络
- AC-003 (initConfig resolve): given mock detect 返回 200000 + user 未配, when initConfig, then provider.contextWindow=200000
- AC-004 (status 端点): given provider 无 contextWindow + 模型表无值, when GET status, then contextWindow=128000
- AC-005 (Usage 事件): given resolved=200000, when agentLoop 发 Usage, then data.contextWindow=200000
- AC-006 (settings 保留): given user 在表单填 contextWindow=50000, when 保存, then POST 写回 yaml contextWindow=50000；空则不写
- AC-007 (真 run): given dashscope /models 无 context 字段, when detect, then undefined → 回退表/用户/128000

## decisions (frozen, feature-scoped)
- DEC-063: 探测值与用户配置取 min（防超真实窗口，支持用户配更小）
- DEC-064: contextWindow optional（undefined=未配，不参与 min 截断）
- DEC-065: 内置模型表仅含确信值（OpenAI 常见模型），probe/user 优先
- DEC-066: detect 带 module-level 缓存（避免重复网络，TTL 长——模型 context 基本不变）

## assumptions
- A-001: context_window 字段名兼容 context_length（部分 provider 用此名）— status: inferred
- A-002: 探测对 OpenAI 官方生效、对 dashscope 静默回退（已实测）— status: confirmed
- A-003: 内置模型表值：gpt-4o/gpt-4o-mini/gpt-4-turbo=128000, gpt-3.5-turbo=16385 — status: inferred（公开规格）
