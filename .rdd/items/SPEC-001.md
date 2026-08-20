---
id: SPEC-001
type: spec
parent: FE-001
status: approved
created: 2026-08-20
approved: 2026-08-20
persists: permanent
scope: FE-001 Session 管理（删除 US-001 + 重命名 US-002）
---

# SPEC-001: Web 端 Session 删除与重命名

## behaviors
- B-001: 用户可在侧栏 session 上触发删除，经弹窗二次确认后删除磁盘 session 文件，列表本地移除该条
- B-002: 用户可在侧栏 session 上 inline 编辑标题（点击标题进入可编辑态，Enter 提交 / Esc 取消），提交后更新磁盘 meta，列表本地刷新标题
- B-003: 删除/重命名经 web route `/api/workspaces/[projectKey]/sessions/[sessionId]`（DELETE / PATCH），调 `SessionService.remove` / `setTitle`，与 agentPool 解耦（DEC-001）

## constraints
- C-001: 删除必须经弹窗二次确认；重命名无需确认（inline edit 提交即可）— status: confirmed
- C-002: 操作以 sessionId 为主键，route 路径参数即 [projectKey]/[sessionId]，不碰 agentId（DEC-001）— status: confirmed
- C-003: domain 层不新增逻辑（remove/setTitle 已有），只加 web route + UI（DEC-003）— status: confirmed
- C-004: 删除为硬删（fs.unlink），不引入回收站，幂等（文件不存在静默）— status: confirmed

## invariants
- I-001: 路径参数隔离——不得删除/修改非目标 projectKey 下的 session — status: confirmed
- I-002: 删除当前活动 session 后，前端不得残留悬空 activeSessionId / 悬空 agentId — status: confirmed

## acceptance_criteria
- AC-001 (删除): given session S 存在于 project P, when 用户在侧栏对 S 触发删除并在弹窗确认, then DELETE /api/workspaces/P/sessions/S 返回成功, 磁盘 `<sessionId>.jsonl` 消失, 列表本地 filter 掉 S
- AC-002 (重命名): given session S 标题 "old", when 用户 inline 改为 "new" 并 Enter 提交, then PATCH /api/workspaces/P/sessions/S 返回成功, 列表本地把 S 的 title 更新为 "new"
- AC-003 (删当前活动): given S 是当前活动 session 且已 resume 为内存 agent, when 用户删 S 并确认, then router.push('/'), agentPool 清除该 agentId, setActiveSession(null)
- AC-004 (取消删除): given 用户点删除弹出确认, when 用户取消, then 不发请求, 列表与磁盘不变
- AC-005 (不存在静默): given S 文件不存在, when DELETE /api/workspaces/P/sessions/S, then 返回成功（幂等）
- AC-006 (跨项目隔离): given 用户对 P1 的 S 操作, when 请求路径含 P1, then 不影响 P2 下的任何 session
- AC-007 (重命名取消): given 用户进入 inline 编辑态, when 按 Esc, then 取消编辑，标题恢复原值，不发请求

## decisions (feature-scoped, frozen)
- Q-002 → 硬删（fs.unlink，幂等）
- Q-003 → 删除弹窗二次确认；重命名 inline edit 无需确认
- Q-004 → 删当前活动 session：跳回列表 + 清 agentPool 该 agentId + setActiveSession(null)
- Q-005 → 列表本地更新 map（删 filter / 改 update title），不重新拉取

## assumptions
- A-001: 重命名走 inline edit（点标题进可编辑态，Enter 提交 / Esc 取消），不另开弹窗 — status: confirmed
