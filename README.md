# AnyCode

**一个轻量级、可扩展的 TypeScript AI 编码助手** · *A lightweight, extensible TypeScript AI coding agent*

AnyCode 用一个响应式 Agent 内核驱动三种交互形态：**Web UI**、**终端 TUI** 和 **CLI**。同一个 `AnyAgent` 实例，既能跑在 Nuxt 服务端经 SSE 把推理过程实时推给浏览器，也能在终端里用 Ink 渲染。Agent 自主使用 `bash` / `read` / `edit` / `glob` / `grep` / `explore` 等工具完成任务，并能委托 sub-agent 拆解复杂任务。

> **English (brief):** AnyCode is a monorepo providing a reactive agent core (`@any-code/domain`) consumed by a Nuxt 3 web app (`@any-code/web`), an Ink-based TUI (`@any-code/tui`), and a CLI. The agent autonomously calls tools to accomplish coding tasks, supports sub-agent delegation, session persistence/resume, and real-time task cancellation. LLM calls are OpenAI-compatible. See the [Roadmap](#roadmap--待实现) for what's done and what's next.

---

## 特性 · Features

**核心引擎（domain）**
- 响应式 Agent 内核：基于 RxJS 的 `task$` 队列 + `concatMap` 串行处理，`submit` / `stop` / `eventStream$` / `pendingTasks$` 响应式 API
- 推理循环 `agentLoop`：think → tool_call → observe → think → respond，按回合（turnId）分组事件
- 真正的任务中断：`AbortController` 贯穿 `AnyAgent` → `agentLoop` → `callLLM` → OpenAI SDK，`stop()` 能真正打断进行中的 LLM 调用，而非仅断开订阅
- 多 Agent：声明式 `AgentDefinition`，`AgentTool` 把一个 agent 包装成工具供父 agent 委托；预置 `plan` sub-agent
- 8 个内置工具 + 工具权限分组（`allTools` / `readOnlyTools` / `executeTools`）
- 会话持久化与恢复：`SessionService` 文件落盘，按 `projectKey` 组织，支持 resume / continueRecent / 列表
- 工作区（Workspace）抽象：bash cwd、文件解析、配置加载均以工作区根目录为锚
- 记忆 / 规则 / 技能：`.anycode/memory.md`、`.anycode/rules/`、`.anycode/skills/` 自动注入 system prompt

**Web UI（web）**
- Nuxt 3 + Tailwind v4 + shadcn-vue 的现代聊天界面
- 多工作区、多会话侧栏：工作区与会话**双重高亮**，自动展开、乐观更新
- SSE 实时事件流：推理回合块状展示，工具调用默认折叠、按需展开看参数与结果
- Markdown 渲染：助手消息按 prose 样式渲染，而非裸源文本
- 真实聊天 UX：用户消息右对齐、发送按钮、停止时显示「已停止任务」
- 历史回放与实时同形：`messagesToEvents` 把持久化消息按回合重建，刷新页面后表现一致

**终端 TUI（tui）**
- Ink / React 19 渲染的终端 UI，`<Static>` 持久化输出
- 会话选择器，CLI 参数透传

---

## 架构 · Architecture

```text
any-code/
├── domain/   @any-code/domain   核心 Agent 逻辑（纯 ESM，对外暴露 AnyAgent）
├── tui/      @any-code/tui       终端 UI（Ink / React 19）
└── web/      @any-code/web       Web UI（Nuxt 3 + Tailwind v4 + shadcn-vue）
```

**事件流与推理循环：**

```text
submit(task) ──→ task$(Subject) ──→ concatMap ──→ executeTask
                                                   │
                              ┌────────────────────┘
                              ↓
                          agentLoop ──→ callLLM ──→ 有 tool_calls?
                              │                         │ 是
                              │                         ↓
                              │                     toolCall ──→ 结果回传 messages
                              │                         │
                              │ ←───────────────────────┘
                              ↓ 无 tool_calls
                          saveMemory + 终态事件（DONE / STOPPED）

  任意环节 → EventStream.submit() → event$ / history$ → 订阅者（Web SSE / TUI / CLI）
```

**Web 数据流：** 浏览器 `EventSource` 连 `/api/agents/:id/events`（SSE）接增量事件，`POST /api/agents/:id/messages` 提交任务。服务端 `agentPool` 持有内存中的 `AnyAgent` 实例（30 分钟闲置回收），Nitro inline 打包 domain 的 TS 源码。

> ⚠️ **安全提示 / Security：** Web 模式下 `bash` 工具会在服务端执行 LLM 生成的 shell 命令。开发服务器**仅监听 127.0.0.1**，切勿直接暴露公网。权限沙箱 / 黑白名单尚在 Roadmap 中。

---

## 快速开始 · Quick Start

### 前置条件

- Node.js ≥ 20
- pnpm（包管理器）
- 一个 OpenAI 兼容的 API 密钥（也支持兼容 OpenAI 接口的第三方服务）

### 安装

```bash
git clone <repo-url> any-code
cd any-code
pnpm install
```

### 配置

复制配置模板并填入你的密钥：

```bash
cp .env.example .env
```

`.env` 内容：

| 变量 | 必填 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | API 密钥 |
| `OPENAI_BASE_URL` | 可选 | API 基础 URL（兼容第三方 OpenAI 接口） |
| `OPENAI_MODEL` | 可选 | 模型名称 |

> TUI / Web 的 CLI 参数（`--api-key` / `--base-url` / `--model`）优先级高于 `.env`，会写入 `process.env`。

### 运行 Web（推荐体验）

```bash
pnpm dev:web          # 启动 Nuxt 开发服务器
# 打开 http://127.0.0.1:3000
```

首次进入用顶栏「添加工作区」选一个本地目录，侧栏「新建对话」即可开始。

### 运行 TUI

```bash
pnpm dev:tui          # 启动终端 UI 开发模式
pnpm dev:tui -- --api-key=sk-xxx --model=gpt-4o   # 带参数
```

### 运行 CLI 示例

domain 包自带一个最小 CLI 入口，订阅事件流并打印：

```bash
cd domain
npx tsx src/cliExample.ts "列出当前目录下的文件"
```

> ⚠️ domain 的 `pnpm dev` / `pnpm start` 脚本指向的入口文件与实际产物名不一致，开发时请用上面的 `npx tsx` 命令。

---

## 配置目录 · `.anycode/`

每个工作区根目录下可放置 `.anycode/` 运行时配置（被 `.gitignore` 忽略，不提交）：

| 路径 | 作用 |
|---|---|
| `.anycode/memory.md` | 跨会话记忆，自动注入 system prompt |
| `.anycode/rules/` | 自定义规则（markdown 文件） |
| `.anycode/skills/` | 自定义技能（markdown 文件） |
| `.anycode/mcp.json` | MCP 工具配置（**目前仅静态 schema 注入，未实现真实协议连接**，见 Roadmap） |

会话数据全局存储于 `~/.anycode/projects/<projectKey>/`，按工作区隔离。

---

## 工具系统 · Tools

`Tool = schema（给 LLM）+ handler（执行）`，handler 接收 `ToolContext`（workspace + eventStream + signal）。

| 工具 | 权限分组 | 作用 |
|---|---|---|
| `bash` | all / execute | 执行 shell 命令 |
| `read` | all / read / execute | 读取文件（支持 offset / limit） |
| `edit` | all / execute | 精确字符串替换编辑 |
| `write` | all / execute | 写入文件 |
| `explore` | all / read / execute | 探索目录结构 |
| `glob` | all / read / execute | 文件名模式匹配 |
| `grep` | all / read / execute | 内容正则搜索 |

- `callLLM` 默认只注入 `readOnlyTools`，主 agent 实际使用 `allTools + AgentTool(planAgent)`。
- `TOOL` 事件统一携带 `{ name, args, result }`，是未来权限拦截的天然钩子点。

### Sub-agent

`AgentTool(AgentDefinition)` 把一个 agent 定义包装成工具。sub-agent 运行在独立 context（独立 messages、独立 eventStream proxy 打上 `author` + `runId`），共享 workspace 与父信号，跑完返回结果字符串。预置的 `plan` sub-agent 负责拆解多步任务。

### 添加新工具

1. 在 `domain/src/tools/functions/` 创建工具实现
2. 在 `domain/src/tools/schema.ts` 添加工具 schema
3. 按需加入 `ToolKit` 的 `allTools` / `readOnlyTools` / `executeTools`

---

## 项目结构 · Project Structure

```text
domain/src/
├── main.ts          AnyAgent 类 — 应用入口，响应式 API
├── core.ts          agentLoop — 核心推理循环
├── llm.ts           callLLM — OpenAI 兼容调用（支持 AbortSignal）
├── agent.ts         AgentDefinition / AgentTool / 预置 plan、main agent
├── context.ts       ToolContext（workspace + eventStream + signal）
├── session/         会话持久化（SessionService + SessionStore）
├── workspace.ts     Workspace 抽象 + WorkspaceRegistry
├── eventStream.ts   EventStream — 基于 RxJS 的事件流
├── memory.ts        .anycode/memory.md 记忆管理
├── rule.ts / skill.ts   规则 / 技能加载
├── mcp.ts           MCP 工具加载（静态 schema）
├── prompt.ts        系统提示词
├── tools/           工具系统（schema + toolCall + functions/）
├── type.ts          类型定义（AgentEvent / EventType / ChatMessage）
└── cliExample.ts    纯命令行示例入口

web/
├── pages/           index（工作区选择）/ chat/[id]（聊天页）
├── components/      AppSidebar / AppTopbar / DirectoryPicker / MarkdownRenderer + ui/*
├── composables/     useAgent（SSE + 历史）/ useWorkspaceState（共享状态）
├── server/api/      agents / workspaces / fs 端点
└── server/utils/    agentPool（内存 agent 池 + 闲置回收）

tui/source/
├── cli.tsx          CLI 入口（meow 参数解析）
└── components/      App / InputBox / Logo / MessageList / SessionSelect
```

---

## 开发 · Development

### 根目录

```bash
pnpm install
pnpm dev:web         # Web 开发模式
pnpm dev:tui         # TUI 开发模式
pnpm dev:domain      # domain 开发模式
pnpm build           # 构建所有包（pnpm -r build）
pnpm test            # 运行所有测试（pnpm -r test）
```

### Domain

```bash
cd domain
npx tsx src/cliExample.ts "你的任务描述"   # 可用的 CLI 入口
pnpm build                                # esbuild 打包 src/index.ts → dist/
npx tsc --noEmit                          # 类型检查
```

### Web

```bash
cd web
pnpm dev           # Nuxt 开发服务器（127.0.0.1:3000）
pnpm build         # 生产构建
```

> 修改 domain 源码后，Nitro 可能缓存旧 bundle，需 `rm -rf .nuxt .nitro` 后重启 dev server。

### TUI

```bash
cd tui
pnpm dev           # tsx 启动
pnpm build         # esbuild 打包
pnpm test          # prettier 格式检查
```

---

## Roadmap / 待实现

下列为**重新核对当前代码后**的真实缺口（不沿用早期需求文档）。

### P0 — 体验与健壮性

| 项 | 现状 | 说明 |
|---|---|---|
| 流式输出 | ❌ 未实现 | `callLLM` 仍为非流式调用，整段返回后才发事件。需改为 streaming + token 级渲染 |
| 错误恢复与重试 | ❌ 未实现 | LLM 调用失败无重试 / 退避策略 |

### P1 — 能力与安全

| 项 | 现状 | 说明 |
|---|---|---|
| 安全沙箱 / 权限模型 | ❌ 未实现 | bash 服务端执行无沙箱；`TOOL` 事件已留 `{name,args,result}` 钩子，但无黑白名单 / bypass / 危险命令确认策略 |
| MCP 协议真实集成 | ⚠️ 仅静态 schema | `loadMcpTools` 只读 `mcp.json` 注入 schema，未实现 stdio / SSE client 真实连接工具 |
| Prompt 工程优化 | ⚠️ 基础 | 系统提示词较基础，未做结构化指令 / few-shot 优化 |
| 交互式确认弹窗 | ❌ 未实现 | plan 模式、危险命令缺少人工确认环节 |
| 单元 / 集成测试 | ❌ 0% | 三个包均无测试，仅 TUI 做 prettier 格式检查 |
| EventStream 多实例 | ✅ 已实现 | 每个 `AnyAgent` 持自己的 `EventStream`（per-agent，非单例），多 agent 并发不串流。生命周期绑 agent，`destroy()` 后随 GC |

### P2 — 扩展

| 项 | 现状 | 说明 |
|---|---|---|
| 记忆系统增强 | ⚠️ 简陋 | 仅追加式 `.anycode/memory.md`，无摘要 / 检索 / 裁剪 |
| 多模型切换 | ❌ 未实现 | 单一 `OPENAI_MODEL`，运行时不可切换 |
| 工具结果截断 / 虚拟滚动 | ❌ 未实现 | 大文件全文进事件，长输出会撑爆 UI |
| CI/CD | ❌ 无 | 无 `.github/workflows` |
| `--verbose` 调试模式 | ❌ 未实现 | 无 LLM 请求/响应、工具调用详情的可观测开关 |

### P3 — 工程化

| 项 | 现状 | 说明 |
|---|---|---|
| npm 发布配置 | ❌ 无 | 未配置发布流程 |
| 新会话落盘后侧栏刷新 | ⚠️ 小缺陷 | Web 新建对话首条消息后，侧栏列表不自动刷新出新会话 |

---

## 贡献 · Contributing

欢迎 Issue 和 PR。提交前请确保：

1. `pnpm build` 通过
2. `cd domain && npx tsc --noEmit` 类型干净
3. 改动符合现有代码风格（prettier）
4. 涉及 domain 改动后，Web 侧记得清 `.nuxt` / `.nitro` 缓存再验证

---

## License

MIT License — 见 [LICENSE](./LICENSE)。

Copyright (c) 2026 AnyJohn
