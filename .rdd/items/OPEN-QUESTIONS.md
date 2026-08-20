---
id: OPEN-QUESTIONS
type: questions
parent: RR-001
status: needs_clarification
created: 2026-08-20
persists: permanent
---

# Open Questions（待 Human 决策）

> blocking 标记的问题不解决无法进入 Spec；非 blocking 可在 Spec Discovery Loop 中收敛。

## FE-001 Session 管理

- **Q-001 [blocking]**「编辑 session」指什么？
  - (a) 仅重命名标题（domain setTitle 已有，轻）
  - (b) 编辑已发送消息（append-only store 需改造，重）
  - (c) 两者都要
- Q-002 删除软删（可恢复）/ 硬删？domain 现状硬删 fs.unlink
- Q-003 删除确认流程（弹窗 / inline / 批量）
- Q-004 删当前活动 session 时 agent 失效如何处理（跳回列表 / 清 agentPool）
- Q-005 删/改名后列表刷新策略（重新拉取 / 本地更新 map）

## FE-002 UX

- Q-006 loading 范围（全场景 / subset，全场景工作量较大）
- **Q-007 [blocking]** 卡片化范围？
  - (a) 仅会话列表
  - (b) 会话列表 + 消息气泡
  - (c) 全布局
- Q-008 是否要「思考中」typing indicator
- Q-009 错误提示是否统一补齐（静默分支较多）

## FE-003 Memory

- **Q-010 [blocking]** LLM 介入模式？
  - (a) 逐条 LLM 判断「记不记」（每任务 +1 次调用 + 延迟）
  - (b) LLM 摘要/蒸馏后记（每任务 +1 次调用，记的是摘要）
  - (c) memory 工具让 LLM 在 agentLoop 内主动调用（改 agentLoop 注入工具，LLM 自主）
  - (d) 组合（如判断 + 摘要）
- **Q-011 [blocking]** workspace / 全局 数据模型？
  - (a) 全局 `~/.anycode/memory.md` + 项目 `<root>/.anycode/memory.md`（现状保持），两层独立
  - (b) 同上但全局可由项目写入（跨 workspace 共享偏好）
  - (c) 其他
- Q-012 记忆是否结构化（importance/tag/source）+ 读取策略（窗口 / RAG / 全量）
- Q-013 记忆格式保持 markdown 还是改 JSONL/结构化（影响兼容旧 memory.md）

## 已决策（DEC-003..006）

- Q-001 → 仅重命名标题（编辑消息不立项）
- Q-007 → 会话列表 + 消息气泡
- Q-010 → memory 工具主动调用
- Q-011 → 两层独立
