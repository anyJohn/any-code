---
id: SPEC-023
type: spec
parent: RR-017
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: maxOutputTokens 配置（探测 + 用户取 min + 传 max_tokens），同 contextWindow 模式
---

# SPEC-023: maxOutputTokens 配置

## behaviors
- B-001: LlmProvider 加 maxOutputTokens?: number（undefined=未配）
- B-002: detectMaxOutputTokens(provider)：GET /models 取 max_output_tokens / max_completion_tokens；与 detectContextWindow 共享缓存（一次 list 取两字段）
- B-003: resolveMaxOutputTokens(provider, detected?)：candidates=[探测, 模型表, 用户] 去空 → min；全空 → undefined
- B-004: initConfig/reloadConfig 探测 + resolve 写回 provider.maxOutputTokens（同 contextWindow）
- B-005: callLLM payload.max_tokens = provider.maxOutputTokens（resolved）；undefined 不传（provider 默认）
- B-006: settings 表单加 maxOutputTokens 输入（空=auto）；fromResponse/toConfigShape 保留

## constraints
- C-001: 探测与用户配置取 min（不超模型真实输出上限） — confirmed（DEC-081）
- C-002: 全空 → undefined（不传 max_tokens，不瞎设） — confirmed（DEC-082）
- C-003: 与 contextWindow 共享 detect 缓存（一次 /models） — confirmed（DEC-083）

## acceptance_criteria
- AC-001 resolveMaxOutputTokens：detected+user→min；仅 detected；仅 user；模型表参与 min；全无→undefined
- AC-002 detectMaxOutputTokens：max_output_tokens/max_completion_tokens 取值；无字段→undefined；与 contextWindow 共享缓存一次 list
- AC-003 callLLM：maxOutputTokens 有→payload.max_tokens=值；undefined→不传
- AC-004 settings 保留 + 真 run 当前模型 回退 undefined

## decisions (frozen)
- DEC-081: 探测与用户取 min
- DEC-082: 全空→undefined（不传 max_tokens）
- DEC-083: 与 contextWindow 共享 detect 缓存
- DEC-084: 内置 max-output 表仅确信值（gpt-4o 16384 等），probe/user 优先
