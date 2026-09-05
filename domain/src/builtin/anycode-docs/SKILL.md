---
name: anycode-docs
description: "AnyCode 自身配置与管理手册——改 config/mcp/tools/skills/rules/memory/proxy 的操作指南"
version: 1.1.0
changes: |
  - abilities 段已废除：内置 web 能力改为原生工具，开关与配置走 tools 段
  - 新增全局出网代理 proxy / no_proxy（LLM 调用与 web 工具统一走此代理）
  - 新增 tools 段通用工具开关与私有配置（每个工具可 enabled + config）
  - 技能源新增 ~/.claude/skills/ 兼容层（Claude Code 技能目录）
---

# AnyCode 配置与管理

AnyCode 是本地 AI 编码 agent。本技能是它自我管理的操作手册——改自己的配置/能力/记忆/规则时先读它。

## 配置文件

唯一来源 `~/.anycode/config.yaml`（全局）。结构：

```yaml
providers: # 命名 provider map
  <name>:
    apiKey: sk-...
    baseURL: https://.../v1 # 可选，OpenAI 兼容（也支持 protocol: anthropic）
    models: [{ id: gpt-4o, name: GPT-4o }]
    defaultModel: gpt-4o
    streaming: true # 可选，缺省 true
    contextWindow: 128000 # 可选，与自动探测取 min
    maxOutputTokens: 4096 # 可选，配才传 max_tokens
default: <name> # 当前生效 provider
mcp: # 第三方 MCP server（enabled:false 保留定义不连）
  <name>: { type: stdio, command: npx, args: [...], env?: {...}, enabled?: true }
  <name>: { type: sse, url: https://..., headers?: {...}, enabled?: true }
tools: # 通用工具开关与私有配置（未配置 = 启用；enabled:false 剔除）
  web_search: { enabled: true, config: { provider: ddg, apiKey: "" } }
  browser_use: { enabled: false, config: { cdpUrl: http://127.0.0.1:9222 } }
proxy: http://127.0.0.1:7890 # 可选，全局出网代理（LLM 调用与 web 工具统一走此）
no_proxy: localhost,127.0.0.1 # 可选，代理豁免
pricing: # 可选，模型单价（$/1M tokens），配了显示会话费用
  gpt-4o: { input: 2.5, output: 10 }
maxConcurrentRuns: 3 # 可选，并行运行上限（0 = 不限）
gitBashPath: ... # 可选，Windows Git Bash 路径
ui: { language: zh } # 可选，界面语言（zh/en，缺省跟随系统）
```

## 改后何时生效

- **config.yaml（providers / mcp / proxy）**：**下条消息即生效**——AnyCode 是 per-request agent（每次 run 新建 agent → initConfig 读盘）。当前 run 用旧 config 完成（不中途 reload，避免中断在途 LLM / MCP 连接），下条消息自动用新配置。无需重启对话。
- **tools 段的工具私有配置**（web_search 的 provider/apiKey、browser_use 的 cdpUrl 等）：**当轮 run 立即生效**——工具每次调用现读。
- **技能 / AGENTS.md / memory.md**：**下条消息即生效**——system prompt 每个任务重建时读盘。
- **模型/Provider 切换**：Web 端用输入框左下角选择器（立即生效于下条消息）。

## 技能（Skills）

四层（优先级 高→低）：项目 `<root>/.anycode/skills/` > 全局 `~/.anycode/skills/` > `~/.agents/skills/` > `~/.claude/skills/`。
- 目录制 `<name>/SKILL.md`（可带 `references/scripts/assets` 子目录；调 `use_skill` 读全文，结果含 `<dir>`，可经 read/glob 读资源）
- 平铺 `<name>.md`（兼容旧格式）
- 同名高层覆盖低层 + warning
- 内置技能：随包 seed 到 `~/.anycode/skills/`（幂等，不覆盖用户改过的；有新版本时提示，可选升级或跳过）
- **创建技能**：用 `create_skill` 工具（name 用小写字母/数字/连字符；自动落对位置，勿手写路径安装）

## 规则（AGENTS.md）

additive 三层注入 system prompt：全局 `~/.anycode/AGENTS.md` + `~/.agents/AGENTS.md` + 项目 `<root>/AGENTS.md`。同目录 `AGENTS.override.md` 顶掉 `AGENTS.md`。下条消息生效。

## 记忆（Memory）

`save_memory` 工具主动写（LLM 决定记什么）：
- 全局 `~/.anycode/memory.md`（scope=global，跨项目偏好）
- 项目 `<root>/.anycode/memory.md`（scope=project，本项目约定）
注入 system prompt，下条消息生效。

## 会话（Sessions）

`~/.anycode/projects/<projectKey>/<sessionId>.jsonl`，按工作区隔离、可 resume。首条任务用 LLM 起简短名。会话支持后台运行（切换会话不中止任务）与压缩（上下文超限时摘要旧消息，UI 历史保留）。

## 工具

内置：`bash` `read` `write` `edit` `explore` `glob` `grep` `save_memory` `create_skill` `ask_question` `use_skill` `job_output` `job_kill` + `plan`（sub-agent 拆解复杂任务）。
web 工具：`web_search` `web_fetch`（联网，代理走全局 proxy）；`browser_use`（CDP 真浏览器：navigate/content/eval，需浏览器 --remote-debugging-port）。

## 常见操作

- **加 MCP**：编辑 config.yaml `mcp` 段加条目（`enabled: true`）→ 下条消息生效。
- **加技能**：优先用 `create_skill` 工具（自动落对位置）；或手动放 `<name>/SKILL.md` 到技能目录 → 下条消息生效。
- **改 provider apiKey / model**：编辑 config.yaml → 下条消息生效（Web 端也可用输入框左下角选择器切换）。
- **开/关工具或配工具参数**：config.yaml `tools` 段（如 `browser_use: { enabled: true, config: { cdpUrl } }`）→ 工具配置当轮生效，开关下条消息生效。
- **配代理**：config.yaml 顶层 `proxy`（被墙的 LLM API / 搜索都必须走它时）→ 下条消息生效。
- **加规则**：写 `AGENTS.md` 到上述三层之一 → 下条消息生效。
- **记记忆**：调 `save_memory` 工具（别手写 memory.md）。

## 约束

- 改 config.yaml 前先 read 确认结构，改完告知用户"下条消息生效"（tools 工具配置当轮生效）。
- 不擅自删用户已有 provider/mcp/技能——只增改，删前 ask_question 确认。
- 内置工具经 config.tools 开关，不可删除注册。
