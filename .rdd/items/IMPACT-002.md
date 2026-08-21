---
id: IMPACT-002
type: impact
parent: RR-002
status: analyzing
created: 2026-08-21
persists: migration-only
---

# Impact Report: 目标 C 影响面

## AnyAgent 公开 API（C 复用，domain 不改）
- `static create({rootPath, sessionId?})` — resume 或新建
- `eventStream$` / `eventHistory$`（getter，已公开）—— C 的 /run handler 订阅 + 回灌历史，与现有 events/route.ts 同模式
- `submit(task)` — fire-and-forget 入 task$（concatMap 串行）
- `stop()` — abort 在途 LLM 调用（abortController.abort）+ stop$.next()
- `destroy()` — stop$.next/complete + destroy$ + clear eventStream（**不 abort 在途 LLM**——C 的 abort 流程需 stop()+destroy() 或 domain 一行微调）

## 删除（web）
- `web/lib/server/agentPool.ts`（整个文件：pool/lastUsed/globalThis/TTL reaper/createAgent/getAgent/removeAgent/__test helpers）
- `web/app/api/agents/route.ts`（POST create）
- `web/app/api/agents/[id]/route.ts`（GET meta / DELETE）+ `[id]/messages` + `[id]/events` + `[id]/stop` + `[id]/history`
- agentId 概念（URL key 从 agentId → sessionId）

## 新增/改写（web）
- `web/app/api/sessions/[sessionId]/run/route.ts`（POST，SSE 流响应：create agent → 订阅 → submit → 泵事件 → 终态收尾 → destroy；abort=stop+destroy）
- `web/app/api/sessions/run/route.ts`（POST，新对话首条消息：无 sessionId，ensureSession 创建，sessionId 经响应头返回）
- `web/app/api/sessions/[sessionId]/history/route.ts`（GET，直读盘 SessionService，不过 agent）
- `web/app/chat/[id]/page.tsx` → `/chat/[sessionId]/page.tsx`（URL 主键换；探测改 history 直读盘，无"已失效"）
- `web/hooks/useAgent.ts` 重写：EventSource → fetch+ReadableStream（POST /run 流响应）；stop=abort fetch；history 单独 GET
- `web/components/AppSidebar.tsx`：resume/newChat 改 sessionId 语义（无 agentId）
- `web/app/page.tsx`：session 列表 resume 走 sessionId

## domain（可选微调）
- `main.ts destroy()` 加 `this.abortController?.abort()`——使"destroy=真停在途 LLM"语义闭合（当前 destroy 只拆订阅不 abort）。非必须（handler 可 stop()+destroy() 补），但更干净。

## backward_compatible
- 旧 `/chat/{agentId}` URL 失效（agentId 无盘后盾）→ 显示"会话不存在，从侧栏选"（agentId 本就无磁盘映射，不可恢复，属预期）
- 现有 session 数据（~/.anycode/projects/.../*.jsonl）不变，按 sessionId 直读
- TUI 不受影响
