# AnyCode

**简体中文** | [English](./README.en.md)

> **A Simple AI Agent** — 简洁是一种能力，克制是一种选择。

一个轻量级的**本地 AI 编码助手**：在你的电脑上运行 AI agent——读代码、跑命令、改文件，自主完成你交代的编码任务。代码与命令全部留在本机。接入任何 OpenAI 兼容模型（亦支持 Anthropic 协议）。

**四种入口**：Web UI（推荐） · 桌面客户端（Electron） · 终端 TUI（开发中） · CLI

## 安装

Linux（bash / zsh / fish）：

```bash
curl -fsSL https://raw.githubusercontent.com/anyJohn/any-code/main/build/install.sh | bash
```

Windows（PowerShell）：

```powershell
iwr -useb https://raw.githubusercontent.com/anyJohn/any-code/main/build/install.ps1 | iex
```

装完打开**新终端**运行 `anycode web`，浏览器自动打开 `http://127.0.0.1:3000`。安装细节见 [build/README.md](./build/README.md)；其他命令：`anycode update` / `uninstall` / `help`。

## 快速使用

1. `anycode web` 打开浏览器界面
2. 顶栏「添加工作区」选一个本地目录——agent 在这个目录里干活
3. `/settings` 填入模型 API 密钥（或直接编辑 `~/.anycode/config.yaml`）
4. 「新建对话」输入任务，例如：*列出当前目录的 TypeScript 文件并解释各自作用*

agent 自主调用工具完成任务，过程实时展示（思考 → 工具调用 → 回答，按回合分组）；随时可停止；**切换会话 / 关闭标签页不中止任务**，多项目可并行。

> ⚠️ **安全**：`bash` 工具会在本机执行 LLM 生成的命令。服务**仅监听 127.0.0.1**，切勿暴露公网；内置工具权限策略（allow / ask / deny + 危险命令确认）兜底。

## 核心特性

- **响应式 agent 内核**：RxJS 驱动推理循环；真中断（AbortController 穿透在途 LLM 调用）
- **多 provider**：OpenAI 兼容 + Anthropic 协议，运行时切换；contextWindow 自动探测
- **工具系统**：bash / 读写文件 / glob-grep（ripgrep）/ MCP（stdio·SSE + 连接池）；权限模式（标准 / 编辑放行 / 信任）+ 危险命令基线；并行执行；参数 schema 校验
- **上下文管理**：分级压缩（micro → 摘要）+ 超限被动恢复；shadow-git 快照与 `/rewind` 回滚
- **会话**：持久化可回放；后台运行与多 agent 并行（关软件才停）；用量与成本统计（pricing 可选）；日志不变式（崩溃重启可重建一致上下文）
- **扩展**：`.anycode/` 项目级 skills / rules / 自定义工具 / 生命周期钩子；sub-agent 委托与 plan 模式
- **界面**：Web / 桌面同源；中英文一键切换；会话级权限确认与跨会话提醒

完整清单见 [feature-list.md](./feature-list.md)。

## 配置

全局 `~/.anycode/config.yaml`，或 Web 端 `/settings` 图形化编辑（热生效）：

```yaml
providers:
  openai:
    apiKey: sk-your-key
    models: [{ id: gpt-4o, name: GPT-4o }]
    defaultModel: gpt-4o
default: openai
mcp: {}          # 可选：MCP servers（stdio / SSE），项目级 .anycode/mcp.yaml 可覆盖
pricing:         # 可选：模型单价（$/1M tokens），配上才显示会话费用
  gpt-4o: { input: 2.5, output: 10 }
```

工作区根目录可放 `.anycode/`（gitignored）：`memory.md`（跨会话记忆）、`skills/`、`rules/`、`tools/*.mjs`（自定义工具）、`hooks.mjs`（生命周期钩子）、`permissions.yaml`（项目级权限规则）、`mcp.yaml`（项目级 MCP）。

## 开发

```bash
git clone https://github.com/anyJohn/any-code.git any-code && cd any-code
pnpm install
pnpm dev:server      # hono server（tsx watch，127.0.0.1:3000）
pnpm dev:web         # Vite（5173，proxy /api → 3000）
pnpm build && pnpm test
```

monorepo（pnpm workspace）：`domain`（agent 内核，纯 ESM）· `server`（hono HTTP adapter，29 路由）· `web`（Vite SPA）· `desktop`（Electron）· `tui`（Ink，开发中）· `build`（一行安装器）。

## Roadmap

守「最小可读内核」定位：**小而全 + 真协议接入生态 + 轻量编排**。已完成项详见 [feature-list.md](./feature-list.md)。

- **待实现**：ACP 轻量编排 / CI-CD / 桌面签名与自动更新 / RAG 跨 Session 长期记忆（远期）
- **明确不做**：一切皆插件框架 · 消息平台网关 · 进程级沙箱（权限策略兜底）· 体量扩张

## 贡献

欢迎 Issue 与 PR。提交前：`pnpm build` 通过、`tsc --noEmit` 干净、风格一致（prettier 默认配置）。

## License

MIT — 见 [LICENSE](./LICENSE)。
