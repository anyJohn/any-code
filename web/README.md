# @any-code/web

基于 Next.js 15 + React 19 + shadcn/ui + Redux Toolkit 的 Web 前端，复用 `@any-code/domain` 的 `AnyAgent`。本地 agent 自用。

## UI 体系

- **shadcn/ui**（new-york 预设，Radix UI 底层）：组件源码在 `components/ui/`，用 `npx shadcn@latest add <组件>` 增补。
- **Tailwind CSS v4**：`@tailwindcss/postcss` 插件，CSS 入口 `app/globals.css`（含主题变量/暗色）。
- **Radix UI**：无样式可访问性原语，shadcn 底层依赖。
- 组件用显式 `import { Button } from "@/components/ui/button"`。
- 样式遵循 shadcn 规则：语义色（`text-muted-foreground` 等）、`gap-*` 不用 `space-x-*`、`cn()` 做条件类。

## 状态管理

- **Redux Toolkit**：`workspaceSlice`（selected / workspaces / activeSessionId）跨页面共享；客户端单例 store + `'use client'` Providers，SSR 仅渲染壳。
- 事件流（events / pending）不进 Redux，留在 `useAgent` hook 局部（高频更新避免渲染代价）。

## 启动

```bash
# 根目录
pnpm install
pnpm dev:web            # next dev --turbopack，监听 127.0.0.1:3000
pnpm --filter @any-code/web start   # 生产模式（next start），同样 127.0.0.1:3000
```

dev 用 **Turbopack**（`next dev --turbopack`）：消费 `transpilePackages` 转译的 domain TS 源码时，
冷编译从 webpack 的 3–5s 降到 ~0.3–1.7s，并避免 webpack dev 的 `clientReferenceManifest` invariant。

> **性能**：dev 模式每路由 warm ~300ms（Next dev 逐请求运行时开销，与 domain 消费方式无关）；
> 要更快用生产模式 `pnpm build && pnpm start`（warm ~5ms）。

需要 LLM 配置。`domain/src/config.ts` 从 `process.cwd()/.env` 加载，Next dev 的 cwd 是 `web/`，
所以把根目录的 `.env` 复制一份到 `web/.env`（或软链）：

```bash
cp ../.env .env        # OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
```

## 开发须知

- **改 domain 源码后**：Next 用 `transpilePackages: ["@any-code/domain"]` 直接转译 domain 的 TS 源码，改完重启 dev 即可（无需先 build domain）。
- 加 shadcn 组件：`npx shadcn@latest add <name> --cwd web`（components.json 已配）。
- 测试：`pnpm test`（Vitest + @testing-library/react + jsdom + msw）。纯函数单测在 `lib/__tests__/`。

## 架构

```text
浏览器 React SPA  ──HTTP──→  Next Route Handlers (app/api)  ──→  AnyAgent (domain)
              ←─SSE──────  agentPool 实例池 + eventStream$
```

- `lib/server/agentPool.ts`：`Map<agentId, AnyAgent>` + TTL 回收，实现 session 亲和。
- `app/api/agents/`：create/resume、SSE events、messages、stop、history。
- `app/api/workspaces/` + `app/api/fs/browse`：工作区注册与目录浏览。
- `hooks/useAgent.ts`：SSE 订阅 + submit/stop + 历史同形。
- `app/page.tsx`：工作区会话列表入口；`app/chat/[id]/page.tsx`：聊天页。

## 路由 key 说明

URL 里的 `:id` 是服务端生成的 **agentId**（UUID），不是 sessionId。
因为 `AnyAgent` 延迟到首条消息才创建 session（`ensureSession`），`create()` 时拿不到 sessionId，
故用独立的 agentId 做路由，与 sessionId 解耦。

## Markdown

`react-markdown` + `remark-gfm` + `remark-breaks`，默认不渲染裸 HTML（XSS 防护）。prose 样式容器，暗色 `prose-invert`。

## 已知限制（P0 范围内可接受）

- **EventStream 是全局单例**（`domain/src/eventStream.ts`）：多个 agent 并发会串流。P0 单用户单 agent 可用；多用户前需 per-agent。
- **session 按 workspace 分区**：`projectKey = projectKeyOf(workspace.rootPath)`，会话存全局 `~/.anycode/projects/<projectKey>/`。web 和 TUI 注册同一个目录即共享会话。
- **安全**：bash 工具服务端执行 LLM 生成的 shell 命令，开发/生产服务器**仅监听 127.0.0.1**，切勿暴露公网。
- **新建对话首条消息后才落盘**（已知小缺陷，P3）：侧栏不自动刷新新会话。
