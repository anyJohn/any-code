---
id: SPEC-014
type: spec
parent: FE-014
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: provider 多模型（models[]+defaultModel）+ /model 切模型 + /provider 切 provider
---

# SPEC-014: provider 多模型 + /model + /provider 指令

## 配置文件形态（扩展）

```yaml
providers:
  openai:
    apiKey: sk-xxx
    baseURL: https://api.openai.com/v1
    streaming: true
    contextWindow: 128000
    models:
      - id: gpt-4o            # 调 API 的真实模型名
        name: GPT-4o          # 展示名（可选）
      - id: gpt-4o-mini
        name: GPT-4o Mini
    defaultModel: gpt-4o      # 当前生效模型 id
  deepseek:
    apiKey: sk-d
    models:
      - id: deepseek-chat
    defaultModel: deepseek-chat
default: openai
mcp: { ... }                   # FE-013 不变
```

## behaviors
- B-001: provider 从单一 `model` 改为 `models: [{id, name?}]` + `defaultModel`（当前模型 id）；不兼容旧 `model:` 单值（未发布无用户）
- B-002: callLLM 用 `provider.defaultModel` 作 API `model` 参数
- B-003: `/model` 指令：无参 → System 显当前模型（provider/defaultModel）+ 列 provider 的 models；`/model <id>` → 切当前 provider 的 defaultModel（按 id 精确匹配）
- B-004: `/provider` 指令：无参 → System 显当前 provider；`/provider <name>` → 切 default provider
- B-005: /settings 编辑 provider 的 models 列表（id+name）+ defaultModel 选择
- B-006: status 显当前模型（defaultModel + name）

## constraints
- C-001: models:[{id,name?}] + defaultModel（DEC-047）— status: confirmed
- C-002: /model 当前 provider 内切 defaultModel（DEC-048）— status: confirmed
- C-003: /model <id> 按 id 精确匹配（DEC-049）— status: confirmed
- C-004: 不兼容旧 model: 单值（DEC-050）— status: confirmed
- C-005: defaultModel 必须在 provider.models 中（校验）— status: confirmed
- C-006: 切模型/切 provider 经 PATCH /api/config（服务端 load+改+save，保留 apiKey）— status: confirmed

## invariants
- I-001: provider 必须有 models（非空）+ defaultModel 在 models 中 — status: confirmed
- I-002: 切模型/切 provider 下次 /run 生效（Config.load 读新值）— status: confirmed

## acceptance_criteria（即测试契约）
- AC-001 (config schema): given config provider 含 models[]+defaultModel, when Config.load, then providers[].models + defaultModel 就位；defaultModel 不在 models → 抛错
- AC-002 (callLLM 用 defaultModel): given provider.defaultModel=gpt-4o-mini, when callLLM, then API payload model=gpt-4o-mini
- AC-003 (/model 切): given /model gpt-4o-mini, when 执行, then PATCH /api/config 切当前 provider defaultModel=gpt-4o-mini；/model 无参 → System 显当前+列 models
- AC-004 (/provider 切): given /provider deepseek, when 执行, then PATCH /api/config 切 default=deepseek；/provider 无参 → System 显当前
- AC-005 (/settings models 编辑): given /settings, when 编辑 provider models(id+name)+defaultModel, when 保存, then POST /api/config 写回
- AC-006 (status 显模型): given status 端点, when GET, then 返 defaultModel + 当前 model name
- AC-007 (无 models 抛错): given provider 无 models 或 defaultModel 不在 models, when Config.load, then 抛错

## open_questions（非 blocking，deferred 下轮）
- Q-014a /model /provider 补全排序（频次/最近）— deferred
- Q-014b model 级 streaming/contextWindow 覆盖（provider 级 vs model 级）— deferred，先 provider 级

## decisions (frozen)
- DEC-047: provider.models:[{id,name?}] + defaultModel（当前模型 id）
- DEC-048: /model 当前 provider 内切 defaultModel
- DEC-049: /model <id> 按 id 精确匹配
- DEC-050: 不兼容旧 model: 单值（未发布无用户）

## assumptions
- A-001: LlmModel={id,name?}；LlmProvider 去 model 加 models+defaultModel；normalize 校验 defaultModel in models — status: inferred
- A-002: PATCH /api/config 扩展：{default? 切 provider, modelId? 切当前 provider 模型}；服务端 load+改+save 保留 apiKey — status: inferred
- A-003: 测试——config.test 验 models+defaultModel 校验；llm.test 验 defaultModel 作 model；web /model//provider 组件测 — status: inferred

## future (deferred)
- /model//provider 补全排序（Q-014a）
- model 级 streaming/contextWindow 覆盖（Q-014b）
