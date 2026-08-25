---
id: SPEC-026
type: spec
parent: null
status: approved
created: 2026-08-25
approved: 2026-08-25
persists: permanent
scope: 工作区删除 + 工作区/会话搜索（todo #5）
---

# SPEC-026: 工作区删除 + 搜索

## 来源
todo.md #5：增加工作区删除功能、session/工作区搜索功能。session 删除已有（侧栏 Trash2 + DELETE 路由），本特性补工作区删除 + 跨工作区搜索。

## behaviors
- B-001: 侧栏工作区行有「删除工作区」按钮 → 弹确认框 → 调 `DELETE /api/workspaces` body {path} 注销（不删磁盘 session 文件、不删源码）→ 刷新注册表；删的是当前选中工作区则清选中 + 跳首页。
- B-002: 侧栏顶部搜索框，输入即 debounce 300ms → `GET /api/search?q=` 服务端跨所有已注册工作区搜：session title 子串 + 工作区 name/rootPath 子串（大小写不敏感）。
- B-003: 搜索结果扁平替换工作区树：分「工作区」「会话」两区；会话条目显 title + workspaceName + 更新日期，按 updatedAt 倒序，上限 50。
- B-004: 点搜索结果——会话：选中其工作区 + setActiveSession + 跳 `/chat/:id` + 清搜索框；工作区：选中 + 跳首页 + 清搜索框。工作区 meta 优先从 redux 已有列表按 projectKey 查，缺失则用 hit 字段构造。
- B-005: 搜索框有清除「×」；空 query → 清结果、回正常树。

## constraints
- C-001: 工作区删除 = 注销（session 文件留盘，重新添加同路径可恢复），非破坏性 — confirmed（沿用现有 DELETE 路由契约 WorkspaceRegistry.remove）
- C-002: 搜索服务端扫（客户端只覆盖已展开工作区的已加载 session，太弱） — confirmed
- C-003: 某工作区 sessions 读盘失败不阻断其他工作区 — confirmed

## acceptance_criteria
- AC-001: 搜索路由单测——空 q 空结果；name/title 大小写不敏感命中；session 带 projectKey/workspaceName；按 updatedAt 倒序；某工作区抛错不阻断其他。
- AC-002: 侧栏工作区行渲染「删除工作区」按钮 → 弹确认框（标题 + 说明 + 取消/移除）；取消不删；确认调 DELETE {path}。
- AC-003: 搜索框输入 → debounce 300ms → fetch → 结果扁平替换树；空/清除回正常树。
- AC-004: 点搜索会话结果 → 跳 /chat/:id + 清搜索框；点工作区结果 → 跳首页 + 清搜索框。
- AC-005（真 UI run）：dev 起来 → 搜"REFACTOR"命中已有 session → 点击跳到该会话页；工作区删除按钮 + 确认框出现 + 取消不删。

## decisions
- DEC-105: 工作区删除 = 注销（WorkspaceRegistry.remove），不删磁盘 session 文件。理由：沿用现有 DELETE 路由契约（非破坏性，重加可恢复）；用户源码绝不动。
- DEC-106: 搜索服务端扫（GET /api/search），非客户端过滤。理由：客户端只覆盖已展开工作区的已加载 session，跨工作区搜不到；服务端遍历 WorkspaceRegistry.list + 各 list(projectKey) 能搜全。
- DEC-107: session 命中上限 50、按 updatedAt 倒序。理由：防巨量结果淹没 UI。

## 实现记录（2026-08-25）
- AC-001 ✓：web/app/api/search/route.ts + search-route.test 5/5（空/name/title/倒序/容错）。
- AC-002/003/004 ✓：AppSidebar 加搜索框（debounce 300ms）+ 结果面板（工作区/会话两区 + 清除×）+ 工作区删除按钮 + 确认框（DELETE /api/workspaces {path} → refreshWorkspaces + 清选中跳首页）。
- AC-005 ✓：Playwright 真 run——搜 REFACTOR 命中 session、点击跳 /chat/:id + 清搜索框；工作区删除按钮 + 确认框 + 取消。
- 全量：web tsc 0 + 115/115。
- deferred：搜索按内容（全文，非 title）需索引；工作区删除时同步清磁盘 session（可选 purge 模式）。
