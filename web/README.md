# @any-code/web

基于 Nuxt 3 + Vue 3 + shadcn-vue 的 Web 前端，复用 `@any-code/domain` 的 `AnyAgent`。本地 agent 自用。

## UI 体系

- **shadcn-vue**（reka-nova 预设）：组件源码在 `components/ui/`，用 `pnpm dlx shadcn-vue@latest add <组件>` 增补。
- **Tailwind CSS v4**：`@tailwindcss/vite` 插件，CSS 入口 `assets/css/main.css`（含主题变量/暗色）。
- **Reka UI**：无样式可访问性原语，shadcn 底层依赖。
- 组件用显式 `import { Button } from "@/components/ui/button"`；`nuxt.config.ts` 里 `components.dirs` 限定只扫 `.vue`，避免 `index.ts` barrel 撞名告警。
- 样式遵循 shadcn 规则：语义色（`text-muted-foreground` 等，不用 raw 颜色）、`gap-*` 不用 `space-x-*`、`cn()` 做条件类。

## 启动

```bash
# 根目录
pnpm install
pnpm dev:web            # 等价 cd web && nuxt dev，监听 127.0.0.1:3000
```

需要 LLM 配置。`domain/src/config.ts` 从 `process.cwd()/.env` 加载，Nuxt dev 的 cwd 是 `web/`，
所以把根目录的 `.env` 复制一份到 `web/.env`（或软链）：

```bash
cp ../.env .env        # OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
```

## 开发须知

- **改 domain 源码后必须 `pnpm --filter @any-code/domain build`**：Nitro 把 `@any-code/domain` 打进 server bundle 时读的是 `dist/index.mjs`（不是 `src/index.ts`，尽管 exports 指向 src）。光重启 nuxt 不够。
- 加 shadcn 组件：`pnpm dlx shadcn-vue@latest add <name> --cwd web`。
- shadcn-vue skill 已装在 `.agents/skills/shadcn-vue`，会按上下文自动触发，指导组件用法/样式规则。

## 架构

```
浏览器 Vue SPA  ──HTTP──→  Nitro server/api 路由  ──→  AnyAgent (domain)
              ←─SSE──────  agentPool 实例池 + event$
```

- `server/utils/agentPool.ts`：`Map<agentId, AnyAgent>` + TTL 回收，实现 session 亲和。
- `server/api/agents/`：create/resume、SSE events、messages、stop、history。
- `server/api/sessions/index.get.ts`：session 列表（`/resume` 选择用）。
- `composables/useAgent.ts`：SSE 订阅 + submit/stop，等价 TUI 的 `initAgent` + rxjs 订阅。`EventSource` 在 `onMounted` 连接（SSR 安全）。
- `pages/`：index（新建/恢复入口）、chat/[id]（聊天页，用 ScrollArea/Input/Button/Card）。

## 路由 key 说明

URL 里的 `:id` 是服务端生成的 **agentId**（UUID），不是 sessionId。
因为 `AnyAgent` 延迟到首条消息才创建 session（见 `domain/src/main.ts` `ensureSession`），
`create()` 时拿不到 sessionId，故用独立的 agentId 做路由，与 sessionId 解耦。

## 已知限制（P0 范围内可接受）

- **EventStream 是全局单例**（`domain/src/eventStream.ts`）：多个 agent 并发会串流。
  P0 单用户单 agent 可用；多用户前需把 EventStream 改成 per-agent。
- **session 按 workspace 分区**：`projectKey = projectKeyOf(workspace.rootPath)`，会话存全局
  `~/.anycode/projects/<projectKey>/`。web 和 TUI 注册同一个目录即共享会话（不再有 cwd 不同步问题）。
- **`#app-manifest` 预转换告警**：Nuxt 3.2x dev 模式已知 Vite 抖动，非阻塞（页面正常 200），生产构建无此问题。
