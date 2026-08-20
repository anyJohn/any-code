---
id: SPEC-002
type: spec
parent: FE-002
status: approved
created: 2026-08-20
approved: 2026-08-20
persists: permanent
scope: FE-002 UX（loading 骨架 US-004 + 卡片化/圆角 US-005 + 思考中/错误提示 US-006）
---

# SPEC-002: Web 端 UX 提升（loading / 卡片 / 圆角 / 反馈）

## behaviors
- B-001: 各数据拉取（sessions 列表 / 历史灌入 / 目录浏览）显示 Skeleton 骨架，区分 loading / empty / error 三态
- B-002: 会话列表项卡片化（Card + border + p-3 + rounded-xl），助手消息加气泡/卡片包裹与用户气泡对称（DEC-004）
- B-003: 圆角统一到 `--radius` 派生变量，消除 sidebar `rounded` / 主区 `rounded-md` / 气泡 `rounded-2xl` 三档混用
- B-004: pending 且助手尚未回任何事件时，消息区显示「思考中」typing indicator
- B-005: apiJson null 的静默分支（newChat / resume / 添加工作区 / sessions 拉取）补错误提示，统一 `text-destructive` 样式

## constraints
- C-001: 引入 `components/ui/skeleton.tsx`（shadcn add 或手写 `animate-pulse`）— status: confirmed
- C-002: 三态严格区分：loading 显示骨架、empty 显示空状态文案、error 显示错误提示，不混叠 — status: confirmed
- C-003: 卡片化范围 = 会话列表 + 消息气泡（DEC-004），不做顶栏/空状态/输入区全布局重排 — status: confirmed
- C-004: 圆角统一不破坏现有 shadcn 组件原语内部实现（改 globals.css --radius 即可，不动 ui/*.tsx）— status: inferred
- C-005: loading 全场景补齐，区分形式（数据列表用骨架，按钮操作用按钮 loading 态）— status: confirmed
- C-006: 做 typing indicator — status: confirmed
- C-007: 错误提示全静默分支补齐，复用 text-destructive — status: confirmed

## invariants
- I-001: loading 期间绝不显示 empty 文案；empty 绝不显示骨架；error 绝不伪装成 empty — status: confirmed
- I-002: 错误提示样式全仓一致（text-destructive 红字模式，复用 DirectoryPicker 现有样式）— status: confirmed

## acceptance_criteria
- AC-001 (sessions loading): given 首次拉 sessions, when 请求 in-flight, then 显示 N 个 Skeleton 占位，不显示"暂无会话"
- AC-002 (sessions empty): given 拉取完成且为空, when 无会话, then 显示空状态文案（含「新建对话」引导）
- AC-003 (sessions error): given 拉取失败, when apiJson 返回 null, then 显示错误提示（text-destructive），不显示空状态
- AC-004 (历史 loading): given 进入 chat 页, when loadHistory in-flight, then 显示骨架，不显示"发送一条消息开始"
- AC-005 (卡片化列表): given sessions 渲染, then 列表项为 Card（border + rounded-xl + p-3），侧栏与主区一致
- AC-006 (消息气泡对称): given 助手消息, then 有气泡/卡片包裹，与用户气泡视觉对称
- AC-007 (思考中): given pending 且助手尚未回任何事件, when 等待中, then 消息区显示 typing indicator
- AC-008 (圆角统一): given 任意组件圆角, then 来自 --radius 派生，无硬编码三档混用
- AC-009 (newChat/resume 反馈): given 用户点新建/切换, when apiJson in-flight/失败, then 按钮显示 loading 态 / 错误提示，不静默

## open_questions
（全部已决策，见 decisions）

## decisions (feature-scoped, frozen)
- Q-006 → 全场景补齐（数据列表用骨架，按钮操作用按钮 loading 态）
- Q-008 → 做 typing indicator
- Q-009 → 错误提示全静默分支补齐，复用 text-destructive

## assumptions
- A-001: loading 全场景补齐，区分形式 — status: confirmed
- A-002: typing indicator 要做 — status: confirmed
- A-003: 错误提示全补齐，复用 text-destructive — status: confirmed
