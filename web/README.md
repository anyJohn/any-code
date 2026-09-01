# @any-code/web

基于 **Vite 7 + React 19 + react-router v7 + Tailwind v4 + shadcn/ui + Redux Toolkit** 的纯客户端 SPA（无 SSR）。不直接依赖 `@any-code/domain`——经 HTTP 调 server（`@any-code/server`）。

## UI 体系

- **shadcn/ui**（new-york 预设，Radix UI 底层）：组件源码在 `components/ui/`，用 `npx shadcn@latest add <组件>` 增补。
- **Tailwind CSS v4**：CSS 入口 `web/globals.css`（含主题变量/暗色）。
- **Radix UI**：无样式可访问性原语，shadcn 底层依赖。
- 组件用显式 `import { Button } from "@/components/ui/button"`。
- 样式遵循 shadcn 规则：语义色（`text-muted-foreground` 等）、`gap-*` 不用 `space-x-*`、`cn()` 做条件类。

## 状态管理

- **Redux Toolkit**：`store/workspaceSlice`（selected / workspaces / activeSessionId / sessionsVersion）只放跨页共享状态。
- 聊天事件流（events / pending / streaming）不进 Redux，留在 `hooks/useAgent` 局部 state（高频更新避免渲染代价）。

## 启动

```bash
# 根目录
pnpm install
pnpm dev:web      # Vite dev，监听 5173，/api 代理 → 127.0.0.1:3000
pnpm dev:server   # hono server（tsx watch），监听 127.0.0.1:3000；改 domain 源码自动重启
```

生产：`pnpm build` 后 server 静态托管 `web/dist`（自写 `staticOrSpa`，SPA fallback 到 index.html）。

需要 LLM 配置。`domain/src/config.ts` 从全局 `~/.anycode/config.yaml` 加载（跨工作区共享）。把仓库根的 `config.example.yaml` 复制到 `~/.anycode/config.yaml` 并填写。

## 开发须知

- **改 domain/server 源码后**：`pnpm dev:server` 用 tsx watch 直接跑 TS 源码，改完自动重启（无需先 build）。
- 加 shadcn 组件：`npx shadcn@latest add <name> --cwd web`（components.json 已配）。
- 测试：`pnpm test`（Vitest + @testing-library/react + jsdom；web 测试配置见 `vitest.config.ts`，`@` 别名 → `web/`）。
- 类型检查：`pnpm typecheck`（tsc --noEmit）。

## 架构

```text
浏览器 React SPA ──fetch/ReadableStream──→  hono server（server/src/index.ts，20 路由）──→ AnyAgent（per-request）
                ←──────────SSE 事件流──────────┘
```

- **per-request agent**：每次 `POST /api/sessions/:sessionId/run` 服务端 `AnyAgent.create`（含 config/MCP 初始化），终态或客户端断开即 `destroy()`（abort 在途 LLM、清理 MCP 子进程）。改配置后下条消息自动生效。
- 路由（react-router v7，`App.tsx`）：`/`（Home，会话列表）、`/chat/:sessionId`（聊天）、`/settings`（图形化配置）。
- `hooks/useAgent.ts`：fetch 流式解析 SSE + submit/stop + 乐观 UI + 历史回放（`GET /history` 灌 initialEvents）。
- `lib/renderItems.ts`：事件 → 渲染项（按 turnId 分组、sub-agent 按 runId 折叠）。
- `lib/sseEvents.ts`：server 事件 payload 的客户端镜像类型。
- `pages/settings/`：设置卡片组（默认提供方 / 模型提供方 / 内置能力 / MCP），模型拉取/测试/弹窗选择。

## 路由 key 说明

URL 里的 `:sessionId` 是服务端 session id（UUID）。新对话先 `POST /api/sessions` 拿 id、`replaceState` 更新 URL（不触发路由重渲染、保留在途流），再 `POST /run`。

## Markdown

`react-markdown` + `remark-gfm` + `remark-breaks`，默认不渲染裸 HTML（XSS 防护）。prose 样式容器，暗色 `prose-invert`。

## 已知限制（P0 范围内可接受）

- **session 按 workspace 分区**：`projectKey = projectKeyOf(workspace.rootPath)`，会话存全局 `~/.anycode/projects/<projectKey>/`。web 和 TUI 注册同一个目录即共享会话。
- **安全**：bash 工具服务端执行 LLM 生成的 shell 命令，开发/生产服务器**仅监听 127.0.0.1**，切勿暴露公网。
- **SSE 断线无自动重连**：网络中断需手动重进会话（历史由 `/history` 回放恢复）。
