---
id: SPEC-016
type: spec
parent: RR-010
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: ChatView 拆分重构——行为保持（拆分前后渲染逐项一致）
---

# SPEC-016: ChatView 组件拆分重构（行为保持）

## behaviors（重构契约：拆分前后渲染逐项一致）
- B-001: ChatView 退化为纯组合容器，持有 useAgent + useCommand + useFileReference，只管布局与滚动
- B-002: 斜杠命令逻辑收敛进 useCommand（拉自定义命令、commandMode/query/filtered、executeCommand、runCommand、runRawCommand）
- B-003: @file 引用收敛进 useFileReference（chips、fileItems、filePopover、selectFile、removeChip、popLastChip）
- B-004: 渲染项（turn/subagent/single）、typing、空状态收敛进 MessageList
- B-005: 输入框 + 命令弹层 + 文件弹层 + chips 收敛进 InputBox（纯展示，逻辑由 hooks 注入）
- B-006: StatusBar / ToolRow / TurnBlock / SubagentBlock 各自独立文件

## constraints
- C-001: 拆分零行为变化——所有既有渲染路径（User 气泡、assistant Markdown、Tool 折叠、sub-agent 折叠、命令弹层、文件弹层、chips、typing、空状态、StatusBar）输出与拆分前逐项一致 — status: confirmed
- C-002: 思考块（SPEC-015）经 TurnBlock 渲染，拆分不破坏 — status: confirmed
- C-003: 滚动管理（首次灌入强滚底 + nearBottom 跟随）保留在 ChatView，scrollRef 透传 MessageList — status: confirmed

## invariants
- I-001: ChatView 的对外 props 不变（sessionId/rootPath/initialEvents/projectKey）
- I-002: useAgent 的消费不变（events/pending/submit/stop/clear/appendSystem）

## acceptance_criteria（行为保持契约，即测试）
- AC-001 (User 气泡): given User 事件, when MessageList 渲染, then 右对齐 primary 气泡含 message
- AC-002 (typing): given pending 且 lastUser 后无 Assistant/Tool, when 渲染, then 显示三点 typing indicator
- AC-003 (空状态): given events 为空, when 渲染, then 显示 "发送一条消息开始对话"
- AC-004 (命令弹层): given draft="/mo" 且有匹配命令, when 渲染 InputBox, then 弹层显示匹配项；ArrowDown/Up 移动 highlight；Enter/Tab 执行 runCommand；Esc 清空
- AC-005 (文件弹层 + chips): given draft 末尾 @token 且有匹配文件, when 渲染, then 弹层显示；Enter/Tab 选中 selectFile；Backspace 于空 draft 删末尾 chip
- AC-006 (ToolRow 折叠): given Tool 事件, when 渲染 ToolRow, then 默认折叠显示摘要，展开显示 result
- AC-007 (SubagentBlock 折叠): given sub-agent 事件组, when 渲染, then 折叠块含 author + events 数，展开按 turn 分组
- AC-008 (StatusBar): given projectKey, when 渲染, then 拉 /status 显示模型/上下文/skill/mcp
- AC-009 (拆分构建): when next build, then 无类型/构建错误（行为保持的编译级证据）

## decisions (frozen, feature-scoped)
- DEC-054: 拆分边界——MessageList/InputBox/StatusBar/ToolRow/TurnBlock/SubagentBlock 组件 + useCommand/useFileReference hooks；ChatView 纯组合
- DEC-005: 输入框键盘逻辑留在 InputBox 内（与弹层状态强耦合，提取到 hook 反而多传 props）

## assumptions
- A-001: 重构无行为变化，故 AC 即"拆分前后一致"的回归契约；纯函数层（renderItems）已有测试覆盖，组件层补行为保持测试 — status: inferred
- A-002: ToolRow/SubagentBlock/StatusBar 为展示型组件，漂移风险低，各补冒烟级测试 — status: inferred

## verification
- 全测试通过（domain + web）
- next build 无错（AC-009）
- 手动走查：用户消息 / assistant / tool 折叠 / sub-agent / 命令弹层 / 文件弹层 / typing / 空状态 / StatusBar
