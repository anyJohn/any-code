---
id: SPEC-023
type: spec
parent: RR-017
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: maxOutputTokens 纯用户配置（不探测/不取 min），照业界主流 harness 保守做法
---

# SPEC-023: maxOutputTokens 配置（简化）

## behaviors
- B-001: LlmProvider.maxOutputTokens?: number（optional，用户配置透传，不探测不 resolve）
- B-002: callLLM——provider.maxOutputTokens 有值 → payload.max_tokens = 该值；undefined → 不传（provider 默认）
- B-003: settings 表单加 maxOutputTokens 输入（空=auto）；fromResponse/toConfigShape 保留

## constraints
- C-001: 不探测 /models 取 max_output_tokens（照业界主流 harness，探测不进请求路径，不拿无人选的数 cap 每次请求） — confirmed
- C-002: 不取 min——纯用户覆盖项（用户配则传，不配则不传） — confirmed
- C-003: 全空(undefined) → 不传 max_tokens — confirmed

## rationale（为何简化，不用 min/探测）
- 探测对主流 OpenAI 兼容 provider 多数无效（dashscope 不返回 max_output_tokens 字段）
- min 会把探测的偏小值强加给用户配置（业界主流 harness 刻意回避）
- 不传时 provider 用合理默认，多数场景够；瞎设反而截断/报错

## acceptance_criteria
- AC-001 provider.maxOutputTokens 用户配 → 透传；未配 → undefined
- AC-002 callLLM：有值→payload.max_tokens=值；undefined→不传
- AC-003 settings 保留 + 真 run 未配→不传

## decisions (frozen)
- DEC-081: 纯用户配置，不探测不取 min（照业界主流 harness catalog.ts:764-771 注释"不拿无人选的数 cap 请求"）
- DEC-082: 全空→undefined→不传 max_tokens
- DEC-083: contextWindow 仍保留探测+min（探测对 dashscope 有效且只影响进度条，错了无害）；maxOutputTokens 不照搬
