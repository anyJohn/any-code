---
id: IMPACT-001
type: impact
parent: RR-001
status: analyzing
created: 2026-08-20
persists: migration-only
---

# Impact Report: 三 Epic 影响面（场景 A 增量改进）

## 影响面汇总

| Feature | domain 改动 | web 改动 | 风险 |
|:---|:---|:---|:---|
| FE-001 Session 管理 | 无（remove/setTitle 已就绪） | 新增 route + AppSidebar UI | 低（domain 不动） |
| FE-002 UX | 无 | 改 page/AppSidebar/ChatView/DirectoryPicker + 引入 Skeleton | 低（纯前端） |
| FE-003 Memory | 改 memory.ts + main.ts:234/252 + workspace.ts 加全局目录 | 可能加 memory 管理 UI（可选） | 中（domain 语义改动 + LLM cost） |

## FE-001 影响文件
- 新增 `web/app/api/workspaces/[projectKey]/sessions/[sessionId]/route.ts`（DELETE + PATCH）
- 改 `web/components/AppSidebar.tsx:135-155`（session 按钮加删除/重命名入口）
- domain 不动（Q-001 若选「编辑消息」才需改 sessionStore，范围扩大）
- 耦合点：sessionId 是主键，route 用 [projectKey]/sessions/[sessionId]，与 agentPool 解耦

## FE-002 影响文件
- 引入 `web/components/ui/skeleton.tsx`
- 改 `web/app/page.tsx:33-36,88-104`、`web/components/AppSidebar.tsx:51-60,128-145`、`web/app/chat/[id]/page.tsx:75-77`、`web/components/ChatView.tsx:111,255-258,273-289`、`web/components/DirectoryPicker.tsx:93-94`
- 改 `web/app/globals.css:75`（--radius 统一圆角）
- 补 apiJson null 静默分支错误提示：`AppSidebar.tsx:58,74,82`、`page.tsx:43,53`、`AppTopbar.tsx:42`

## FE-003 影响文件
- `domain/src/memory.ts`（saveMemory/loadMemory 加 LLM 介入 + 分层签名）
- `domain/src/main.ts:234`（写调用）、`main.ts:252`（读调用，getSystemMessage）
- `domain/src/workspace.ts:29,137-140`（加全局目录常量 + workspaceConfigDir 配套）
- `domain/src/core.ts`（若 Q-010 选 memory 工具模式，需 agentLoop 注入工具）

## backward_compatible
- FE-001/FE-002：纯增量，兼容
- FE-003：memory 格式若改结构化，需兼容旧 markdown（读时降级），否则破坏现有 .anycode/memory.md
