# AnyCode

> **A Simple AI Agent**
>
> 简洁是一种能力，克制是一种选择。我们以更少、更清晰的内核，让强大的能力保持简单。
>
> *Simplicity is capability, restraint a choice — we keep powerful capability simple with a smaller, clearer kernel.*

**一个轻量级的本地 AI 编码助手** · *A lightweight local AI coding agent*

AnyCode 在**你的电脑上本地**运行一个 AI agent：它读你的代码、跑命令、改文件，自主完成你交代的编码任务。所有命令都在本机执行，代码不离开你的机器。四种用法：**Web UI（浏览器，推荐）**、**桌面客户端（Electron）**、终端 TUI（开发中）、CLI。同一个 agent 内核，接 OpenAI 兼容模型。

> **English:** AnyCode runs a local AI agent that reads code, runs commands, and edits files to finish coding tasks you give it. Everything runs locally; your code never leaves your machine. Web UI (recommended), terminal TUI (WIP), CLI. OpenAI-compatible models.

---

## 安装 · Install

一行命令安装：

**Linux**（bash / zsh / fish）：

```bash
curl -fsSL https://raw.githubusercontent.com/anyJohn/any-code/main/build/install.sh | bash
```

**Windows**（PowerShell）：

```powershell
iwr -useb https://raw.githubusercontent.com/anyJohn/any-code/main/build/install.ps1 | iex
```

装完打开**新终端**运行 `anycode web`，浏览器自动打开 `http://127.0.0.1:3000`。安装细节见 [`build/README.md`](./build/README.md)。

> 其他命令：`anycode update`（升级到最新）、`anycode uninstall`（卸载）、`anycode help`（用法）。

---

## 快速使用 · Quick Start

1. 新终端运行 `anycode web`，浏览器自动打开 `http://127.0.0.1:3000`。
2. 首次进入：点顶栏「添加工作区」选一个本地目录——agent 在这个目录里干活（跑命令、读写文件都以此为根）。
3. 进 `/settings` 填入 OpenAI 兼容 provider 的 API 密钥（也可直接编辑 `~/.anycode/config.yaml`）。
4. 侧栏「新建对话」，输入任务，例如：
   > 列出当前目录有哪些 TypeScript 文件，并解释每个的作用。

agent 自主调 `bash` / `read` / `grep` 等工具完成任务，过程实时显示在聊天里：**思考 → 工具调用 → 结果 → 回答**，按回合块状展示，工具调用默认折叠、点开看参数与输出。随时点「停止」可中断进行中的任务（会真正打断 LLM 调用，不是只断开页面）。

> ⚠️ **安全提示：** Web 模式下 `bash` 工具会在本机执行 LLM 生成的 shell 命令。服务**仅监听 127.0.0.1**，切勿暴露公网。工具级权限策略 / 危险命令确认尚在路线图。

---

## 配置 · Configuration

所有配置在 `~/.anycode/config.yaml`（全局，跨工作区共享），也可在 Web 端 `/settings` 图形化编辑（改完热生效，无需重启）：

```yaml
providers:
  openai:
    apiKey: sk-your-key
    baseURL: https://api.openai.com/v1   # 可选
    models: [{ id: gpt-4o, name: GPT-4o }]
    defaultModel: gpt-4o
    streaming: true                       # 可选，缺省 true
  deepseek:
    apiKey: sk-your-deepseek-key
    baseURL: https://api.deepseek.com/v1
    models: [{ id: deepseek-chat }]
    defaultModel: deepseek-chat
default: openai                           # 当前生效 provider
mcp:                                    # 可选：全局 MCP servers（项目级 .anycode/mcp.yaml 覆盖）
  example-server:
    type: stdio                          # 或 sse
    command: npx
    args: ["-y", "some-mcp-server"]
    env: { KEY: value }                  # 可选
```

- **多 provider + 运行时切换**：`/model`、`/provider` 指令或 `/settings` 切换；per-request agent 下条消息自动用新配置。
- **`contextWindow`**：可选配；自动探测（GET /models 的 context_window）+ 内置表 + 用户配置取最小，用于进度条，避免超窗口。
- **`maxOutputTokens`**：可选配；纯用户覆盖项（配则传 max_tokens，不配则用 provider 默认）。

### 工作区本地配置 `.anycode/`

每个工作区根目录可放 `.anycode/`（被 `.gitignore` 忽略，不提交）：

| 路径 | 作用 |
| --- | --- |
| `.anycode/memory.md` | 跨会话记忆，自动注入 system prompt |
| `.anycode/rules/` | 自定义规则（markdown 文件） |
| `.anycode/skills/` | 自定义技能（markdown 文件） |
| `.anycode/mcp.yaml` | 项目级 MCP servers（覆盖全局 config.yaml 的 `mcp` 段；stdio/SSE 真协议连接） |

会话数据全局存储于 `~/.anycode/projects/<projectKey>/`，按工作区隔离，支持 resume。

---

## 开发者指南 · For Developers

## 源码开发

```bash
git clone https://github.com/anyJohn/any-code.git any-code
cd any-code
pnpm install
pnpm dev:web          # Vite dev（5173），proxy /api → 127.0.0.1:3000
pnpm dev:server       # hono server dev（tsx watch，127.0.0.1:3000）
# 或 pnpm dev:tui / pnpm dev:domain
```

根目录常用命令：

```bash
pnpm build            # 构建所有包（pnpm -r build）
pnpm test             # 运行所有测试（pnpm -r test）
```

> dev：`pnpm dev:server`（tsx watch）+ `pnpm dev:web`（vite 5173，proxy `/api`→3000）；改 domain 源码后 tsx watch 自动重启 server。

## 架构 · Architecture

monorepo（pnpm workspace）：

```text
any-code/
├── domain/   @any-code/domain   核心 Agent 逻辑（纯 ESM，对外暴露 AnyAgent）
├── server/   @any-code/server   hono node server（HTTP driving adapter，20 路由，import domain）
├── web/      @any-code/web       Web UI（Vite SPA + React 19 + react-router + Tailwind v4 + shadcn/ui）
├── tui/      @any-code/tui       终端 UI（Ink / React 19，开发中）
└── build/    安装脚本与启动器（一行安装）
```

**事件流与推理循环：**

```text
submit(task) ──→ task$(Subject) ──→ concatMap ──→ executeTask
                                                   │
                              ┌────────────────────┘
                              ↓
                          agentLoop ──→ callLLM（流式 onDelta/onThinkingDelta）──→ 有 tool_calls?
                              │                         │ 是
                              │                         ↓
                              │                     toolCall ──→ 结果回传 messages
                              │                         │
                              │ ←───────────────────────┘
                              ↓ 无 tool_calls
                          终态事件（DONE / STOPPED）

  任意环节 → 该 agent 的 EventStream.submit()（per-agent，非全局单例）
            → event$ / history$ → 订阅者（Web SSE / TUI / CLI）
```

**Web 数据流：** 浏览器 `fetch`+`ReadableStream` 连 `POST /api/sessions/:id/run`（SSE 流）提交任务并接增量事件。服务端 `/run`（`server/src/index.ts`，hono）每 request 创建一个 `AnyAgent`（`AnyAgent.create`），单飞（同一 session 并发跑返 409），终态或客户端断开即 `destroy()` 并 abort 在途 LLM。20 个 API 路由在 `server/src/index.ts`（Web Request/Response 同构）；domain TS 源码经 server 的 esbuild 打进自包含 `dist/server.mjs`，prod 时 launcher 起 server + serve 静态 `web/dist`（无 node_modules、无 junction）。

## 工具系统 · Tools

`Tool = schema（给 LLM）+ handler（执行）`，handler 接 `ToolContext`（workspace + eventStream + signal + llm + fileState + gitBashPath）。

| 工具 | 权限分组 | 作用 |
| --- | --- | --- |
| `bash` | all / execute | 执行 shell 命令（显式 `bash -c`，流式上抛输出） |
| `read` | all / read / execute | 读取文件（支持 offset / limit，记 mtime） |
| `edit` | all / execute | 精确字符串替换编辑 |
| `write` | all / execute | 写入文件（原子写 + staleness 检测） |
| `explore` | all / read / execute | 探索目录结构 |
| `glob` | all / read / execute | 文件名模式匹配（ripgrep） |
| `grep` | all / read / execute | 内容正则搜索（ripgrep） |
| `save_memory` | all / execute | 写记忆（LLM 主动调用，非自动） |

- `callLLM` 默认只注入 `readOnlyTools`，主 agent 实际使用 `allTools + AgentTool(planAgent)`。
- `TOOL` 事件统一携带 `{ name, args, result }`，是未来权限拦截的天然钩子点。

### Sub-agent

`AgentTool(AgentDefinition)` 把一个 agent 定义包装成工具。sub-agent 运行在独立 context（独立 messages、独立 eventStream proxy 打上 `author` + `runId`），共享 workspace / signal / llm / fileState，跑完返回结果字符串。预置的 `plan` sub-agent 负责拆解多步任务。

### 跨平台 bash

- Linux/macOS：`/bin/sh -c`。
- Windows：内嵌 busybox-w32（sh + coreutils），保持 bash 全平台统一、prompt/skills 不分叉。bash 路径可在 `~/.anycode/config.yaml` 顶层 `gitBashPath` 配置；bash.ts 候选序：`ANYCODE_BASH_PATH`（桌面/launcher 注入）→ config `gitBashPath` → busybox 下发位置 → 系统 Git for Windows。

## 项目结构 · Project Structure

```text
domain/src/
├── main.ts          AnyAgent 类 — 应用入口，响应式 API
├── core.ts          agentLoop — 核心推理循环
├── llm.ts           callLLM — OpenAI 兼容调用（流式 + AbortSignal）
├── agent.ts         AgentDefinition / AgentTool / 预置 plan、main agent
├── context.ts       ToolContext（workspace + eventStream + signal + llm + fileState + gitBashPath）
├── config.ts        Config — ~/.anycode/config.yaml 加载（多 provider + contextWindow/maxOutputTokens + gitBashPath）
├── session/         会话持久化（SessionService + SessionStore）
├── workspace.ts     Workspace 抽象 + WorkspaceRegistry + globalConfigDir
├── eventStream.ts   EventStream — 基于 RxJS 的事件流（per-agent）
├── memory.ts        .anycode/memory.md 记忆管理
├── rule.ts / skill.ts   规则 / 技能加载
├── mcp.ts           MCP 工具加载（stdio/SSE 真协议连接 + call_tool 转发，per-agent 建连/清理）
├── ripgrep.ts       runRipgrep（async 解析 rg 二进制：ANYCODE_RG_PATH → vendored rg → @vscode/ripgrep fallback）
├── prompt.ts        系统提示词 + workspace/memory 注入段 + compact 摘要器 prompt
├── tools/           工具系统（schema + toolCall + functions/）
├── type.ts          类型定义（AgentEvent / EventType / ChatMessage）
└── cliExample.ts    纯命令行示例入口

server/               hono node server（20 API 路由，import domain）
├── src/             index.ts（hono app + 20 路由 + 自写 staticOrSpa 静态托管 + start）/ main.ts（入口）/ singleFlight.ts
└── test/            routes.test.ts

web/                  Vite SPA + react-router（静态 dist/，无 SSR）
├── pages/           Home / Chat / Settings（react-router 路由）
├── components/       AppShell / AppSidebar / ChatView / MessageList / ToolRow / ThinkingBlock / TurnBlock / SubagentBlock / ui/*
├── hooks/           useAgent / useCommand / useFileReference / useRedux
└── lib/              api / atFile / renderItems

build/                一行安装脚本（install.sh / install.ps1 / launcher.* / versions.env）
```

## 贡献 · Contributing

欢迎 Issue 和 PR。提交前请确保：

1. `pnpm build` 通过
2. `cd domain && npx tsc --noEmit` 类型干净
3. 改动符合现有代码风格（prettier）
4. 公开仓库：commit / 注释 / 文档不写外部产品名（用中性描述）

---

## Roadmap / 现状

anycode 守"最小可读内核"定位：**小而全 + 真协议接入生态 + 轻量编排**，不与大型 harness 拼体量。

### 已实现

| 项 | 说明 |
| --- | --- |
| 响应式 Agent 内核 | RxJS `task$` + concatMap 串行；`submit`/`stop`/`eventStream$`/`pendingTasks$` |
| 真 AbortController 取消 | `stop()` 信号穿进 OpenAI SDK，中断在途 LLM（非仅断订阅） |
| 流式输出 | `callLLM` token 级流式（onDelta/onThinkingDelta + 工具参数流式心跳）|
| 多 provider + 运行时切换 | `~/.anycode/config.yaml` 多 provider + `/model` `/provider`；per-request agent 下条消息自动用新配置 |
| contextWindow / maxOutputTokens | 探测 + 表 + 用户取 min / 纯用户覆盖 |
| 子 agent 委托 | `AgentTool(planAgent)` 声明式子 agent + tagged EventStream |
| 两层记忆 + save_memory | 全局 `~/.anycode/memory.md` + 项目 `.anycode/memory.md`，LLM 主动调用写入 |
| 文件系统（ripgrep） | glob/grep/explore 走 @vscode/ripgrep（server bundle externalize 它，运行时走 vendored rg via ANYCODE_RG_PATH）；read 记 mtime、write 原子写 + staleness 检测 |
| MCP 真协议连接 | `loadMcpTools` 真建连（stdio spawn / SSE HTTP）+ listTools + call_tool 转发，per-agent 建连/清理，单 server 失败不阻断 |
| 上下文压缩 | `/compact [focus]` 指令 + agentLoop 75% 自动压缩（旧消息→摘要 + 保留尾部 + tool 配对保护）|
| 端到端安装（v1） | Linux/Windows 一行安装脚本 + `anycode web`（非技术用户开箱即用）|
| 安装生命周期 | `anycode update`（复用安装器重拉重建）/ `uninstall`（删 ~/.anycode）/ `help` |
| 可靠性（AR-1/AR-2/FR-14） | LLM 调用重试退避（Retry-After 优先）+ bash 输出双限截断与 spill + timeout_ms 可配 + 任务终态枚举（上限明示） |
| 核心路径单测 | domain + web + server vitest 全绿 |
| Electron 桌面客户端 | frameless 窗口 + 内置窗口控件 + 内嵌 hono sidecar；打包 AppImage / NSIS / mac zip（代码签名与自动更新待做） |

### 待实现

| 项 | 说明 |
| --- | --- |
| 权限策略层 | `TOOL` 事件已留 `{name,args,result}` 拦截点，缺 allow/deny/ask 策略 + 危险命令确认；`ask_question` 工具（模型向 human 提问/选择）待加 |
| 程序性记忆 / 自学习 | 加 `create_skill` 工具让 agent 自造 skill，"越用越强"最小循环 |
| 轻量编排切入 | ACP 委托外部 harness，或 `delegate_to_cli` 调外部 coding agent |
| CI/CD | 无 workflow（`anycode update` 已实现，自更新靠重跑安装器） |
| 桌面签名与自动更新 | 代码签名（SmartScreen/Gatekeeper）+ electron-updater 随发布流一起做 |

### 明确不做

- ❌ "一切皆插件"插件框架——体量过大
- ❌ 多通道消息网关（WhatsApp/Telegram…）——与定位无关
- ❌ 进程/文件系统级沙箱——太重，用权限策略兜底
- ❌ 体量扩张——保持小而清晰是卖点

---

## License

MIT License — 见 [LICENSE](./LICENSE)。

Copyright (c) 2026 AnyJohn
