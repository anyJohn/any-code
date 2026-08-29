# AnyCode Features

## Core Features

- 多平台适配
  - 源码安装 / 源码编译模式支持 Windows、Mac、Linux（Windows 内嵌 Git Bash 保持 bash 全平台统一）
  - 桌面打包分发：Windows、Linux、macOS（mac 出 arm64 zip / 解包 .app，未签名；dmg + 签名需在 macOS 上构建）
  - Web 与 TUI 共用一套前端代码（React + Vite + hono server），"一次编译，到处运行"
- 流式 / 非流式响应
  - 通过 config 配置 `streaming`，支持流式与非流式模型
- Skill
  - Project 级别 Skill（`<root>/.anycode/skills/`）
  - Global 级别 Skill（`~/.anycode/skills/`）
  - 兼容 `~/.agents/skills/` 目录下 Skill（已实现，最低用户层）
  - 技能即文件：目录制 `<name>/SKILL.md`（可带 `references/scripts/assets` 子目录，agent 可读）或平铺 `<name>.md`；内置技能 = 安装时 seed 进 `~/.anycode/skills/` 的普通技能（无特殊内置层，FE-022）
  - 内置连接器（abilities 注册器——仅 mcp：web-fetch / web-search / browser-use 真浏览器 CDP，可开关不可删，FE-022）
- Memory
  - 原文层：Session History（durable 事件日志，含 thinking / tool call / 报错 / usage 等，reload 重放）
  - 摘要层：Global + Workspace/project 的跨 Session 摘要，经 `save_memory` agent tool 主动写入（LLM 决定记什么）
  - 召回层：暂无计划，可后续用 RAG 将各 Session History 向量化存储 + 召回
- Sessions
  - 持久化（thinking、tool calling、报错信息、usage、压缩事件等全覆盖）
  - 支持 Session 重命名与删除
- Workspace / Project
  - 添加 / 删除 workspace
  - workspace 持久化（`~/.anycode/projects/<projectKey>/`，按工作区隔离、可 resume）
- Tools（Function Calling）
  - `bash`，执行 shell 命令（流式上抛输出）
  - `edit`，按 old string 精确替换编辑（唯一匹配校验；staleness：mtime 漂移→警告不阻断，写后记新 mtime，SPEC-022）
  - `explore`，探索目录结构
  - `glob`，文件名模式匹配（ripgrep）
  - `grep`，内容正则搜索（ripgrep，性能强，尊重 .gitignore）
  - `read`，支持长文件切片读取（offset / limit，记 mtime）
  - `write`，原子写 + staleness 检测
  - `save_memory`，写入项目级与用户级记忆
  - `ask_question`，向 human 提问 / 让 human 选择（经 InteractionModal）
  - `use_skill`，按名读技能全文（目录注入 <available_skills>，正文按需取）
  - 内置连接器工具：`web_search` / `web_fetch`（联网，回显只显搜索词与 URL）、browser-use（`browser_navigate/content/eval` 真 CDP）
- compact（上下文压缩）
  - 单 session 真实 usage ≥ 75% 自动压缩
  - 手动指令 `/compact [聚焦]` 压缩
  - 保留最近若干消息，确保压缩不影响当前工作
  - 压缩失败发非终态 Warning（不误终止 run）
- subagents
  - Plan agent，复杂任务委托 plan sub-agent 拆解（预置，声明式 `AgentTool(AgentDefinition)`）
  - task agent，并行执行任务（todo）
  - 可观测：sub-agent 经 tagged proxy EventStream（author + runId）转发到父流，Web SubagentBlock 分组渲染（基础可观测已完成；更富的实时面板 todo）
- MCP（`@modelcontextprotocol/sdk`）
  - 支持 stdio 格式 MCP
  - 支持 SSE 格式 MCP
  - 全局 `config.yaml` 配置或项目级 `.anycode/mcp.yaml` 覆盖；真协议连接，per-agent 建连 / 清理，单 server 失败不阻断
- config.yaml 全局配置管理
  - 多 provider + 运行时切换；contextWindow 自动探测 + maxOutputTokens 覆盖；gitBashPath
- Status
  - 展示上下文容量状态（进度条）
  - 展示当前模型与 Provider
  - 展示可用 Skill 数与 MCP 数
- Command（slash 指令）
  - `/model` 切换模型
  - `/provider` 切换 provider
  - `/compact` 压缩上下文
  - `/config` 打开设置
  - `/sessions` 列出对话
  - `/clear` 清空对话
  - `/new` 新建对话
  - `/help` 帮助
  - 重命名 Session：侧栏 inline 编辑（已实现，非 slash 指令）
  - `@` 引用文件
  - Skill 注入 Command（todo）
  - `/rename` (todo)
- Rule
  - 支持 `.anycode` 目录下的 AGENTS.md 规则文件（已实现，additive + 同目录 override，FE-022）
  - 支持 `~/.agents` 目录下的 AGENTS.md 规则文件（已实现）
  - 支持 Workspace 目录下的 AGENTS.md 规则文件（已实现）；`.anycode/rules/` 多文件已退役（破坏性）
- Plugin（todo，暂不实现）
  - 拓展 Command
  - 拓展 subagents
  - 通过各种 Hook 为扩展提供能力
  - 通过扩展修改 UI

## Web Features

- 布局 AppShell：圆角卡片浮于 app 底色（品牌靛蓝顶光晕），侧栏可拖拽调宽 + 折叠（持久化）
- 侧栏 AppSidebar：工作区 Collapsible 列表 + 会话列表；跨工作区搜索；添加 / 删除工作区、新建 / 删除 / 重命名会话（inline）；设置入口
- 顶栏 AppTopbar：当前工作区 + 切换下拉（最近工作区）+ 添加工作区
- 首页 Home：品牌 hero（logo + tagline）+ 当前工作区会话列表 / 空状态引导
- 聊天 Chat：流式事件按 turn 块状渲染——thinking / tool / assistant / usage / compact / error / warning；用户气泡；空状态引导
- 工具调用 ToolRow：默认折叠显摘要，展开看参数与 result；活动工具卡片显实时执行 / 参数生成进度
- sub-agent SubagentBlock：sub-agent 事件分组渲染（author / runId 打标）
- 交互 InteractionModal：`ask_question` 工具向 human 提问 / 选择
- 输入 InputBox：slash 命令补全、`@` 文件引用、上下文压缩 indeterminate 进度条、停止 / 发送
- 状态栏 StatusBar：模型 / Provider、上下文用量进度、Skill 数、MCP 数
- 设置 Settings：`config.yaml` 图形化编辑，卡片可折叠（默认提供方 → 模型提供方 → 内置能力 → MCP 服务，FE-022）；内置能力开关用 Switch、web-search 行内 provider（ddg/tavily/bing）+ API Key 配置，热生效
- 品牌识别：Logo（badge / glyph 双变体）+ 品牌靛蓝主题（`--primary`）+ favicon；选中色 / 细滚动条
- Markdown 渲染（prose）+ 代码块
- 历史持久化重放：durable 事件日志作 reload 真值，退役反推重建（SPEC-030）
- 桌面端 TitleBar：无边框窗口内置控件（仅 Electron 内渲染，浏览器模式无）

## Desktop Features

- Electron + hono sidecar：嵌入 server（不 spawn 子进程，用 Electron 自带 node 跑），关窗 = server.stop 无后台残留
- 自包含 bundle：web-dist + rg（四个平台二进制独立命名，main 按 platform+arch 选）+ (win) busybox 全打进 resources/，一份 resources 跨平台、双击即用、不依赖 prior install
- 无边框窗口（`frame:false`）+ app 图标 = anycode logo + 内置窗口控件（TitleBar：最小化 / 最大化·还原 / 关闭，整栏可拖窗）
- Windows：NSIS 安装器（可选安装目录、卸载时确认删 `~/.anycode`）
- Linux：AppImage
- macOS：arm64 zip + 解包 .app（Linux 交叉构建，未签名 → Gatekeeper 需右键→打开；关窗驻 Dock、activate 重开）；dmg + 代码签名需 macOS（后续）
- 打包脚本：`build:linux` / `build:win` / `build:mac`（arm64，另有 `build:mac:x64` / `build:mac:universal`）
- app.asar 瘦身（todo）：domain/server 已由 esbuild 内联进 main.cjs，运行期无需再打包，挪 devDependencies 可减 ~30MB 产物
- 更新：新版本提示 + 自动更新（设计已定：`electron-updater` + GitHub Releases，Win 全自动差分、Linux AppImage 自动 + 降级打开下载页；待实现；前提需先建 GitHub Releases 发布流）

## Tui Features

- Ink / React 19 终端 UI（早期，开发中）
- Session 选择（SessionSelect）
- 消息列表（MessageList）
- 输入框（InputBox）
- Logo
- 与 Web 共用 `@any-code/domain` 内核（AnyAgent），同样经事件流驱动
