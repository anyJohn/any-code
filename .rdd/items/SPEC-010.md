---
id: SPEC-010
type: spec
parent: FE-010
status: approved
created: 2026-08-22
approved: 2026-08-22
persists: permanent
scope: Web slash 指令（内置 + 自定义 .anycode/commands/ + 输入框 / 补全 + 行内反馈）
---

# SPEC-010: Web slash 指令

## behaviors
- B-001: 输入框首字符 `/` → 弹指令列表（内置 + `.anycode/commands/*.md` 自定义），模糊匹配补全；Tab/Enter 选中执行
- B-002: 内置指令：`/clear`（清当前对话事件，本地不删 session）、`/new`（跳 /chat/new）、`/help`（System 事件列全部指令）、`/config`（跳 /settings）、`/model`（System 显当前 provider/model；`/model <name>` 切 default 经 POST /api/config）、`/sessions`（System 列最近会话）
- B-003: 自定义指令：`.anycode/commands/*.md` → 文件名即指令名，body 是 prompt 模板，选中后作 user 消息提交（走正常 agent run）；支持参数（指令后文本拼到模板后）
- B-004: 指令执行反馈 = 行内 System 事件（如「已清空对话」「已切到 deepseek」）
- B-005: `/` 指令与 `@file` 可同输入（DEC-039）：输入框解析同时识别 `/`（指令）与 `@`（文件引用）；`@file` 注入由 FE-011 实现，FE-010 的输入框解析不破坏 `@`

## constraints
- C-001: 内置指令 /clear /new /help /config /model /sessions（DEC-037）— status: confirmed
- C-002: 自定义指令 .anycode/commands/*.md，body = prompt 模板作 user 消息提交（DEC-038）— status: confirmed
- C-003: `/` 与 `@file` 可同输入（DEC-039）— status: confirmed（@ 注入属 FE-011）
- C-004: 反馈 = 行内 System 事件（DEC-040）— status: confirmed
- C-005: `/model <name>` 切 default 经 POST /api/config（复用 FE-009）— status: confirmed
- C-006: 指令列表来源：内置常量 + 扫描 `.anycode/commands/*.md`（经 GET /api 或 web 端 fs）— status: inferred

## invariants
- I-001: 输入 `/` 开头才触发指令模式；普通文本走正常提交 — status: confirmed
- I-002: 内置指令优先于同名自定义（冲突时内置生效，自定义跳过记错）— status: inferred

## acceptance_criteria（即测试契约）
- AC-001 (/ 触发补全): given 输入框首字符 `/`, when 渲染, then 弹指令列表（内置 + 自定义）按剩余文本模糊匹配；Tab/Enter 选中
- AC-002 (内置执行): given 选中 /clear, when 执行, then 清当前 events（本地）+ System 事件「已清空对话」；/new 跳 /chat/new；/config 跳 /settings；/help System 列指令；/model System 显当前；/model deepseek 切 default
- AC-003 (自定义指令): given `.anycode/commands/review.md` 存在, when 输入 /review 选中, then 其 body 作 user 消息提交走 agent run
- AC-004 (反馈): given 指令执行, when 完成, then 聊天插一条 System 事件（不 toast）
- AC-005 (与 @ 同输入): given 输入 `/review @src/a.ts`, when 解析, then 识别 /review 指令 + @src/a.ts 文件引用（@ 注入由 FE-011 实现，FE-010 不破坏该解析）

## open_questions（非 blocking，deferred 下轮）
- Q-010a 自定义指令 frontmatter（description/args 元数据）— inferred，先只认文件名+body
- Q-010b /model 切换是否需确认（当前 provider 在用时）— deferred
- Q-010c 指令历史/补全排序（频次/最近）— deferred

## decisions (frozen)
- DEC-037: 更多内置指令（/clear /new /help /config /model /sessions）
- DEC-038: 自定义指令 .anycode/commands/*.md，body = prompt 模板作 user 消息提交
- DEC-039: `/` 与 `@file` 可同输入（输入框同时解析 / 与 @；@ 注入属 FE-011）
- DEC-040: 指令执行反馈 = 行内 System 事件

## assumptions
- A-001: 自定义指令列表经 GET /api/workspaces/:pk/commands（扫 .anycode/commands/*.md）或复用 status 端点扩展 — status: inferred
- A-002: 测试——web 组件测（/ 触发弹列表、内置执行、自定义提交）+ /api/commands 端点测 — status: inferred

## future (deferred)
- 自定义指令 frontmatter 元数据（Q-010a）
- /model 切换确认（Q-010b）
- 指令补全排序（Q-010c）
