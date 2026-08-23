---
id: SPEC-008
type: spec
parent: FE-008
status: approved
created: 2026-08-22
approved: 2026-08-22
persists: permanent
scope: 配置文件（YAML）+ 多 provider + provider 粒度流式开关 + 热更新机制（domain，配置只从文件读）
---

# SPEC-008: 配置文件 + 多 provider + 流式开关

> 修订：废弃 `.env` / 环境变量（含 `${VAR}` 引用），所有配置只从 `.anycode/config.yaml` 读（DEC-028，覆盖原 C-005/C-006/AC-005/AC-006）。
>
> 再修订：配置改**全局** `~/.anycode/config.yaml`（跨工作区共享，不按工作区隔离）。`Config.load()` / `Config.save(data)` 去 workspace 参数；web 改用 `/api/config`（全局）。skills/memory/rules 仍按工作区。

## 配置文件形态（.anycode/config.yaml）

```yaml
providers:
  openai:
    apiKey: sk-xxx                       # 字面量（config.yaml 在 .anycode/ 内，已 gitignored，本地安全）
    baseURL: https://api.openai.com/v1   # 可选
    model: gpt-4o
    streaming: true                       # 可选，缺省 true
  deepseek:
    apiKey: sk-deepseek
    baseURL: https://api.deepseek.com/v1
    model: deepseek-chat
    streaming: false                      # 该 provider 不支持流式
default: openai
```

## behaviors
- B-001: Config 从 `<workspace>/.anycode/config.yaml` 加载（YAML，js-yaml），含 `providers` map + `default`；无文件 / 无 provider / default 未定义 → 抛错引导建配置（不再退回 .env）
- B-002: 多 provider：命名 provider 各带 `apiKey`/`baseURL?`/`model`/`streaming?`；`default` 指向当前生效 provider
- B-003: 流式开关 provider 粒度：callLLM 读当前 provider 的 `streaming` 决定 `stream:true/false`（DEC-027）
- B-004: 运行时切 default：web 热更新改 `default` 字段 + 重载 → agent 下次 callLLM 用新 provider（DEC-026；web 触发属 FE-009，本 SPEC 提供 domain 机制 `Config.reload()`）
- B-005: callLLM 用当前 provider 的 apiKey/baseURL/model/streaming 调 OpenAI SDK；`llm` 参数必填（由 AnyAgent 从 Config 解析传入）

## constraints
- C-001: YAML + js-yaml 依赖，配置在 `.anycode/config.yaml`（DEC-024）— status: confirmed
- C-002: 命名 provider map（`providers: {name: {...}}` + `default`）（DEC-025）— status: confirmed
- C-003: default + 热更新切（改 default 字段 + reload，下次调用生效）（DEC-026）— status: confirmed
- C-004: 流式 provider 粒度（各 provider 自带 `streaming`，callLLM 读当前 provider 的）（DEC-027）— status: confirmed
- C-005: 配置只从 config.yaml 读，**不读 .env / 环境变量**（无 .env 后备）；无文件抛错（DEC-028）— status: confirmed
- C-006: callLLM 不再自建 Config；provider 设置由调用方（AnyAgent）传入，必填 — status: confirmed

## invariants
- I-001: 无 config.yaml → Config.load 抛错（不再退回 env）— status: confirmed
- I-002: 切 provider 不影响在途 callLLM（下次调用才用新 provider）— status: confirmed
- I-003: streaming 缺省 true（向后兼容 FE-007 流式默认）— status: confirmed
- I-004: 不再有任何 `process.env.OPENAI_*` 读取（dotenv 已移除）— status: confirmed

## acceptance_criteria（即测试契约）
- AC-001 (config.yaml 加载): given `<ws>/.anycode/config.yaml` 含 2 provider + `default: openai`, when `Config.load(workspace)`, then 返回 providers map（2 项）+ default="openai"
- AC-002 (provider 字段): given provider 配置含 apiKey/baseURL/model/streaming, when 加载, then 各字段就位；`streaming` 缺省时为 true
- AC-003 (流式 provider 粒度): given 当前 default provider `streaming: false`, when callLLM 调用, then `stream:false`（非流式，整段返回，不发 ASSISTANT_DELTA）；`streaming: true` 则流式（发 delta）
- AC-004 (切 default): given 配置 openai + deepseek，default=openai，when 改 default=deepseek + reload，then 下次 callLLM 用 deepseek 的 apiKey/baseURL/model/streaming
- AC-005 (无配置抛错): given 无 config.yaml, when `Config.load(workspace)`, then 抛错（引导建配置，不退回 env）；无 providers / default 未定义同样抛错
- AC-006 (热更新机制): given Config 已加载，when `reload()`，then 重读文件，新 default/provider 生效（供 FE-009 web 触发）

## open_questions（非 blocking，deferred 下轮）
- Q-008b 配置校验（schema 校验报错友好提示）— deferred
- Q-008c 全局配置项（除 provider 外，如 maxIterations 默认）— deferred

## decisions (frozen)
- DEC-024: YAML (.anycode/config.yaml) + js-yaml——人友好、支持注释、主流 agent 配置选择
- DEC-025: 命名 provider map（providers: {name: {apiKey, baseURL?, model, streaming?}} + default）
- DEC-026: default + 热更新切——配置定 default，web 改 default + reload，下次调用生效；per-request 切留 FE-010 /model
- DEC-027: 流式 provider 粒度——各 provider 自带 streaming，比全局更灵活（有不支持流式的 provider/模型）
- DEC-028: 废弃 .env / 环境变量（含 ${VAR} 引用），所有配置只从 .anycode/config.yaml 读；config.yaml 在 gitignored 的 .anycode/ 内，apiKey 字面量本地安全。dotenv 依赖移除、TUI --api-key/--base-url/--model 旗标移除、.env.example 删除、config.example.yaml 模板提供

## assumptions
- A-001: callLLM 改为接收 provider 设置（apiKey/baseURL/model/streaming），由 AnyAgent 从 Config 解析后传入；AnyAgent 持 Config 并在 reload 后更新 — status: confirmed
- A-002: 测试策略——写临时 config.yaml，验 Config.load 解析 + 无文件抛错 + callLLM 读 streaming 走流式/非流式分支 — status: confirmed

## future (deferred)
- 配置 schema 校验 + 友好报错 → Q-008b
- 全局配置项（maxIterations 等）→ Q-008c
- provider 健康检查（连通性探测）→ FE-012 状态面板
