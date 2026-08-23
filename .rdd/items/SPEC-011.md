---
id: SPEC-011
type: spec
parent: FE-011
status: approved
created: 2026-08-22
approved: 2026-08-22
persists: permanent
scope: Web @file 引用（注入路径，agent read 读取；文件发现尊重 gitignore）
---

# SPEC-011: Web @file 引用文件

> 修订：@file 注入**路径**（非内容），agent 用 read 工具读取——agentic，支持所有格式，web 端不拉内容/不截断/不判二进制。文件发现尊重 .gitignore。

## behaviors
- B-001: 输入框 `@` 触发 → 文件模糊匹配 popover（递归扫 workspace，按 `@` 后文本匹配，限 20 条，**尊重 .gitignore** + 跳 node_modules/.git/.next/dist/.cache；不排除二进制——agent read 支持所有格式）；↑↓ 高亮，Tab/Enter 选中
- B-002: 选中 → 插入 `@path` chip（显示文件名，tooltip 全路径，backspace 可删）
- B-003: 提交时各 chip 的**路径**注入 user 消息（相对 root 路径引用，agent 用 read 工具按需读取）——agentic，无需 web 端内容拉取/截断/二进制处理
- B-004: 路径相对 workspace root（agent read 工具以 workspace root 为锚）
- B-005: `/` 指令与 `@file` 可同输入共存（`/` 开头走指令模式 FE-010，否则正常文本可含 `@` chip）

## constraints
- C-001: @file 注入**路径**（agent read 读取，支持所有格式，agentic）（DEC-041 修订）— status: confirmed
- C-002: 文件发现模糊匹配 + **尊重 .gitignore** + 跳 node_modules/.git/.next/dist/.cache；限 20；不排除二进制（DEC-042 修订）— status: confirmed
- C-003: 路径相对 workspace root（DEC-043）— status: confirmed
- C-004: chip 可删 + 文件名 + tooltip 全路径（DEC-044）— status: confirmed
- C-005: 文件发现经 GET /api/workspaces/:pk/files?q=（web 浏览器无 fs）；**无内容拉取接口**（路径注入，agent read）— status: confirmed
- C-006: .gitignore 尊重用 `ignore` 包或基础模式匹配（读 workspace 各级 .gitignore）— status: inferred

## invariants
- I-001: `@` 触发文件补全；`/` 开头走指令模式（FE-010），两者不互斥但不同时主导 — status: confirmed
- I-002: 注入的是**路径**（agent 自主 read），非文件内容 — status: confirmed
- I-003: gitignored 文件不出现在 @ 补全列表 — status: confirmed

## acceptance_criteria（即测试契约）
- AC-001 (@ 触发补全): given 输入框出现 `@<token>`, when 渲染, then 弹文件 popover（模糊匹配 workspace 文件，限 20，尊重 .gitignore，跳 node_modules/.git 等）；↑↓+Tab/Enter 选中
- AC-002 (chip): given 选中文件, when 插入, then `@path` chip（文件名 + tooltip 全路径，backspace 删）
- AC-003 (路径注入): given 提交含 @chip 的消息, when 发送, then 各 chip 的**相对路径**注入 user 消息（如 "user text\n\nFiles: rel/path1, rel/path2"），agent 用 read 工具读取（无 web 内容拉取）
- AC-004 (相对路径): given chip 路径, when 注入, then 相对 workspace root 的路径
- AC-005 (/ 与 @ 共存): given 输入含 `/` 与 `@`, when 解析, then `/` 开头走指令（FE-010），否则文本 + `@` chip
- AC-006 (gitignore 尊重): given workspace 有 .gitignore 忽略某文件, when @ 补全, then 该文件不出现在结果

## open_questions（非 blocking，deferred 下轮）
- Q-011a .gitignore 解析深度（多级 .gitignore + 否定模式 !）— inferred，用 `ignore` 包处理
- Q-011b 文件发现缓存/性能（大 workspace 扫描慢）— deferred
- Q-011c 多 @chip 顺序/去重 — deferred

## decisions (frozen)
- DEC-041: @file 注入**路径**（agent read 读取，支持所有格式，agentic）——修订自原"全文注入"
- DEC-042: 文件发现模糊匹配 + 尊重 .gitignore + 跳 node_modules 等；不排除二进制——修订自原"跳二进制"
- DEC-043: 路径相对 workspace root
- DEC-044: chip 可删 + 文件名 + tooltip 全路径

## assumptions
- A-001: GET /api/workspaces/:pk/files?q=prefix 返 [{path, name}]（尊重 gitignore）；无 GET /file 内容接口 — status: confirmed
- A-002: 测试——/api/files 端点测（含 gitignore 尊重）+ ChatView @ 触发/chip/路径注入组件测 — status: inferred

## future (deferred)
- .gitignore 多级/否定模式深度（Q-011a）
- 文件发现缓存/性能（Q-011b）
- 多 chip 顺序/去重（Q-011c）
- @ 目录引用 → 非本 SPEC
