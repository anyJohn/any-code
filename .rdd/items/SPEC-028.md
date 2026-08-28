---
id: SPEC-028
type: spec
parent: FE-019
status: approved
created: 2026-08-28
approved: 2026-08-28
persists: permanent
scope: FE-019 web 重构为 Vite SPA + hono node server（DEC-007 范式落地）
---

# SPEC-028: web 重构为 Vite SPA + hono node server

> 跨特性架构决策见 DEC-007（静态 SPA + hono sidecar）。本 SPEC 是 FE-019 的 feature-scoped 规格。
> 场景 B（整体替换）：删 Next.js web，用 Vite+hono 替代；旧行为作回归基线（FE-019 现状）。

## behaviors
- B-001: `anycode web` 启动后，hono server 绑定 `127.0.0.1`（仅本地回环），一个进程同时 serve 静态 `dist/`（SPA）+ 14 个 API 端点。
- B-002: 浏览器访问根路径返回 SPA `index.html`；客户端路由（react-router v7）接管 `/`、`/chat/:sessionId`、`/settings`。
- B-003: 14 个 API 端点的请求/响应/SSE 语义与 Next 版本一致（回归基线，见 I-002）。
- B-004: `/api/sessions/:id/run` 仍为 SSE 流式（`text/event-stream`，`Response(ReadableStream)`），`useAgent` 的 `fetch+ReadableStream` 解析不改。
- B-005: 构建产物 = 静态 `dist/`（Vite build）+ server bundle；运行时只需 `dist/` + server bundle + vendored rg + 私有 node。`dist/` 与 server bundle 均无 `node_modules`、无 pnpm `.pnpm` 符号链接/junction。
- B-006: launcher 起 hono server（替原 next standalone `server.js`），复用 freePort 探活 + 浏览器自动开 + `ANYCODE_RG_PATH` 注入。
- B-007: `@any-code/server` 包可被外部进程（如未来 Electron main）import/spawn 起一个 server 接 API——"为桌面端打基础"的最小验证点。

## constraints
- C-001: server 包只依赖 `@any-code/domain`，不 import `@any-code/web`；web（SPA）不 import domain（只经 HTTP）。— status: confirmed
- C-002: server 无业务逻辑（纯 HTTP↔AnyAgent API 翻译）；agent 决策（跑不跑/哪个工具/压缩）全在 domain。— status: confirmed
- C-003: 仅监听 `127.0.0.1`（安全：bash 工具跑 LLM 生成的命令，不暴露公网）。— status: confirmed
- C-004: `@any-code/domain` 包核心代码不动（不改 AnyAgent/agentLoop/tools/session/compact/mcp/ripgrep 等）。— status: confirmed
- C-005: 构建产物无 pnpm `.pnpm` 虚拟 store 符号链接/junction（Vite 静态 `dist/` 无 node_modules；server bundle 经 esbuild 打包无 `.pnpm`）。— status: confirmed
- C-006: `@any-code/tui` 不受影响（仍是 domain 的 in-process driving adapter，独立 transport）。— status: confirmed

## invariants
- I-001: Windows / Linux / macOS 上 `anycode web` 不再出现 standalone junction EPERM（`dist/` 无 node_modules）。— status: confirmed
- I-002: 现有 14 API 端点的请求/响应契约不变（回归基线）。端点集：`/api/workspaces`(+子)、`/api/sessions`(+run/compact/history/interact/子)、`/api/config`、`/api/fs/browse`、`/api/search`。— status: confirmed
- I-003: SSE 事件流协议不变（`EventType` 枚举 / `turnId` / `runId` / `author` 等），`web/hooks/useAgent` 不改。— status: confirmed
- I-004: ripgrep 仍可用（vendor rg 到 `runtime/rg/` + `ANYCODE_RG_PATH` 机制不变）。— status: confirmed

## acceptance_criteria
- AC-001 (启动): given 干净安装的 anycode, when `anycode web`, then hono server 起 `127.0.0.1:<freePort>`, 浏览器自动开, 访问根路径返回 SPA index.html（HTTP 200）。
- AC-002 (API 回归): given 14 个 API 端点, when 用现有 web SPA 调各端点, then 行为与 Next 版本逐一对齐（workspaces 列/增/删/改名、sessions 列/建/run SSE/history/compact/interact、config 读写、fs/browse、search）。
- AC-003 (SSE): given 一个 session, when `POST /api/sessions/:id/run` 携 task, then 返回 `text/event-stream`, 事件序列同 Next 版本（Iteration/Thinking/Tool/AssistantDelta/Assistant/Usage/Done/Stopped），前端 `useAgent` 正常渲染。
- AC-004 (无 junction): given 构建产物 `dist/` + server bundle, when 扫描, then 无符号链接/junction、无 `.pnpm` 目录。
- AC-005 (Windows 无 EPERM): given Windows 机器, when `anycode web`, then 不报 `EPERM: ...stat '...styled-jsx'`，SPA + API 正常工作。
- AC-006 (domain 不动): given 重构后, when `cd domain && npx vitest run`, then 全绿（domain 包代码无改动）。
- AC-007 (rg): given `anycode web` 运行中, when agent 调 grep/glob/explore 工具, then ripgrep 正常返回结果。
- AC-008 (桌面可复用): given `@any-code/server` 包, when 一个外部 node 进程 `import` 它并起一个 server, then 能绑 127.0.0.1 + 响应 API（打基础验证，无需真接 Electron）。
- AC-009 (构建链): given install.sh/ps1, when 跑安装, then `vite build` 产 `dist/` + 打包 server bundle，无 `next build` / 无 standalone post-process，产物体积不增。

## open_questions（非 blocking，已按推荐定档）
- Q-018: dev 形态 → **Vite dev server + proxy `/api`→hono**（selected, confirmed）。
- Q-019: API 前缀 → **保持 `/api/*`**（selected, confirmed）。
- Q-020: `next/image` 替代 → **普通 `<img>`**（selected, confirmed）。

## decisions（feature-scoped, frozen）
- Q-014 → 迁移策略：big-bang 全量替换 Next（不并存双跑）。
- Q-015 → 包结构：新建 `@any-code/server` 包（web SPA + server 分离，domain 复用 + 桌面端独立 spawn）。
- Q-016 → 静态 dist serve：web 模式 hono 一体 serve（dist + API 一个进程）；桌面端 Electron `loadFile` dist + spawn server sidecar。
- Q-017 → 前端路由：react-router v7。
- 契约层 → 隐式（暂不抽 `@any-code/api` 契约包；渐进式，类型 drift 痛了再抽，参 DEC-007 影响范围）。

## assumptions（已确认）
- A-001: dev 用 Vite dev server + proxy `/api`（与 `@`）到 hono server。— status: confirmed
- A-002: API 前缀保持 `/api/*`（与 Next 版本一致，最小行为变更）。— status: confirmed
- A-003: `next/image` 用普通 `<img>` 替代（本地 UI 不需图片优化器）。— status: confirmed
- A-004: launcher 复用现有 freePort 探活 + 浏览器自动开 + `ANYCODE_RG_PATH` 注入逻辑。— status: confirmed
- A-005: install.sh/ps1 构建链改为 `vite build`（产 `dist/`）+ esbuild 打包 server bundle；保留 vendor rg；去 `next build` / standalone post-process。— status: confirmed
- A-006: server 包用 hono + `@modelcontextprotocol/sdk`（domain 已有）+ tsx/esbuild 跑；端口经 launcher 注入。— status: confirmed
