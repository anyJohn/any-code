---
name: anycode-docs
description: "AnyCode 自身配置与管理手册——改 config/mcp/abilities/skills/rules/memory 的操作指南"
---

# AnyCode 配置与管理

AnyCode 是本地 AI 编码 agent。本技能是它自我管理的操作手册——改自己的配置/能力/记忆/规则时先读它。

## 配置文件

唯一来源 `~/.anycode/config.yaml`（全局）。结构：

```yaml
providers: # 命名 provider map
  <name>:
    apiKey: sk-...
    baseURL: https://.../v1 # 可选，OpenAI 兼容
    models: [{ id: gpt-4o, name: GPT-4o }]
    defaultModel: gpt-4o
    streaming: true # 可选，缺省 true
    contextWindow: 128000 # 可选，与自动探测取 min
    maxOutputTokens: 4096 # 可选，配才传 max_tokens
default: <name> # 当前生效 provider
mcp: # 第三方 MCP server（enabled:false 保留定义不连）
  <name>: { type: stdio, command: npx, args: [...], env?: {...}, enabled?: true }
  <name>: { type: sse, url: https://..., headers?: {...}, enabled?: true }
abilities: # 内置连接器开关（未配置 = 关）
  web-fetch: { enabled: true }
  web-search: { enabled: true, config: { provider: ddg|tavily|bing, apiKey: "" } }
  browser-use: { enabled: false, config: { cdpUrl: http://127.0.0.1:9222 } }
gitBashPath: ... # 可选，Windows Git Bash 路径
```

## 改后何时生效

- **config.yaml（providers / mcp / abilities）**：**下条消息即生效**——AnyCode 是 per-request agent（每次 run 新建 agent → initConfig / initMcp 读盘）。当前 run 用旧 config 完成（不中途 reload，避免中断在途 LLM / MCP 连接），下条消息自动用新配置。无需重启对话。
- **技能 / AGENTS.md / memory.md**：**下条消息即生效**——system prompt 每个任务重建时读盘。
- **provider / model 运行时切换**：`/model`、`/provider` 指令热切（当前 run 立即生效）。

## 技能（Skills）

三层（优先级 高→低）：项目 `<root>/.anycode/skills/` > 全局 `~/.anycode/skills/` > `~/.agents/skills/`。
- 目录制 `<name>/SKILL.md`（可带 `references/scripts/assets` 子目录；调 `use_skill` 读全文，结果含 `<dir>`，可经 read/glob 读资源）
- 平铺 `<name>.md`（兼容旧格式）
- 同名高层覆盖低层 + warning
- 内置技能：随包 `src/builtin/<name>/SKILL.md`，首启 seed 到 `~/.anycode/skills/`（幂等，不覆盖用户改过的）

## 规则（AGENTS.md）

additive 三层注入 system prompt：全局 `~/.anycode/AGENTS.md` + `~/.agents/AGENTS.md` + 项目 `<root>/AGENTS.md`。同目录 `AGENTS.override.md` 顶掉 `AGENTS.md`。下条消息生效。

## 记忆（Memory）

`save_memory` 工具主动写（LLM 决定记什么）：
- 全局 `~/.anycode/memory.md`（scope=global，跨项目偏好）
- 项目 `<root>/.anycode/memory.md`（scope=project，本项目约定）
注入 system prompt，下条消息生效。

## 会话（Sessions）

`~/.anycode/projects/<projectKey>/<sessionId>.jsonl`，按工作区隔离、可 resume。首条任务用 LLM 起简短名。

## 工具

内置：`bash` `read` `write` `edit` `explore` `glob` `grep` `save_memory` `ask_question` `use_skill` + `plan`（sub-agent 拆解复杂任务）。
连接器（启用后）：`web_search` `web_fetch`（web-search/web-fetch）；`browser_navigate` `browser_content` `browser_eval`（browser-use CDP，需 chrome --remote-debugging-port=9222）。

## 常见操作

- **加 MCP**：编辑 config.yaml `mcp` 段加条目（`enabled: true`）→ 下条消息生效。
- **加技能**：放 `<name>/SKILL.md` 到 `~/.anycode/skills/`（全局）或项目 `.anycode/skills/`（项目）→ 下条消息生效。
- **改 provider apiKey / model**：编辑 config.yaml → 下条消息生效（或 `/model` `/provider` 当前 run 热切）。
- **开连接器**：config.yaml `abilities.<name>.enabled: true`（web-search 配 provider/apiKey、browser-use 配 cdpUrl）→ 下条消息生效。
- **加规则**：写 `AGENTS.md` 到上述三层之一 → 下条消息生效。
- **记记忆**：调 `save_memory` 工具（别手写 memory.md）。

## 约束

- 改 config.yaml 前先 read 确认结构，改完告知用户"下条消息生效"（当前 run 仍用旧配置）。
- 不擅自删用户已有 provider/mcp/技能——只增改，删前 ask_question 确认。
- abilities 内置连接器不可删（registry），只能 enabled 开关。
