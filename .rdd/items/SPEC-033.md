---
id: SPEC-033
type: spec
story: FE-024
parent: FE-024
status: completed
owner: human
created: 2026-09-02
persists: permanent
origin: docs/架构和功能改进需求.md FR-30
---

# SPEC: 后台运行与多 agent 并行

```yaml
spec:
  id: SPEC-033
  story: FE-024
  status: completed

  behaviors:
    - id: B-001
      description: "POST /api/sessions/:id/run 提交后，agent 存活期与客户端连接解耦：断开连接只移除订阅者，不 abort 不 destroy"
    - id: B-002
      description: "server 维护运行中 agent 注册表（AgentManager）；GET /api/sessions/:id/stream?since=N 以 per-run 单调递增序号增量续传事件"
    - id: B-003
      description: "POST /api/sessions/:id/stop 显式停止：abort 当前 run，终态 stopped，清理注册表（可从任意视图发起）"
    - id: B-004
      description: "会话列表接口返回每个会话的运行状态（running / waiting_ask / idle）及 pending ask 摘要；web 左侧列表在名称右侧渲染状态徽标"
    - id: B-005
      description: "权限 ask 不再超时自动拒绝：挂起等待直到用户响应或 run 被 abort/stop"
    - id: B-006
      description: "全局并发闸 maxConcurrentRuns（config，缺省 3，0=不限）：满载时新 run 排队等待空位后自动开始"
    - id: B-007
      description: "server 进程收到 SIGINT/SIGTERM 时 destroy 全部运行中 agent 后退出"
    - id: B-008
      description: "重挂时 agent 不在托管表（run 已结束 / 未开始）→ 404，客户端回退 /history 全量刷新后从最新位置续传"
    - id: B-009
      description: "刷新页面 / 重进运行中会话后：恢复事件流；pending ask（如有）经重放仍可响应"
    - id: B-010
      description: "同会话 single-flight 保持：运行中再次 POST /run 返回 409"

  constraints:
    - id: C-001
      description: "客户端断开不得触发 agent.destroy（行为反转，现有 /run 断连测试需同步修订）"
    - id: C-002
      description: "domain 不感知 server/web（分层守卫保持）；托管逻辑全部在 server driving adapter"
    - id: C-003
      description: "事件序号 per-run 单调递增（0 起，等于 eventHistory$ 下标）；跨 run 由重挂 404 → 客户端全量刷新衔接"
    - id: C-004
      description: "任何客户端行为不得隐式停止 run；停止只经显式 API 或 server 退出"
    - id: C-005
      description: "FR-14 / SPEC-031 终态事件语义不变（done/stopped/error 及事件载荷）"

  invariants:
    - id: I-001
      description: "agent 实例存活期 ⊆ [run 开始, 终态 destroy 或 server 退出]"
    - id: I-002
      description: "每个会话至多一个活跃 run"
    - id: I-003
      description: "destroy 前必须 flush 完在途事件；销毁后不得再发出任何事件"

  acceptance_criteria:
    - id: AC-001
      given: "会话 A 运行中"
      when: "前端切到会话 B（A 的 SSE 断开）"
      then: "A 的 run 不被 abort，最终到达终态并落盘"
    - id: AC-002
      given: "订阅者断开期间会话产生了事件 E(n+1..m)"
      when: "以 since=n 重挂 stream"
      then: "按序收到 n+1..m，不丢不重"
    - id: AC-003
      given: "重挂时该会话无运行中 agent"
      when: "GET /stream?since=N"
      then: "404，客户端回退 /history 全量刷新后从最新位置续传"
    - id: AC-004
      given: "会话运行中"
      when: "POST /stop（从另一会话视图发起）"
      then: "run abort、终态 stopped、列表状态回 idle"
    - id: AC-005
      given: "两个不同项目会话同时运行"
      when: "各自产生事件"
      then: "事件互不串扰，状态独立更新"
    - id: AC-006
      given: "maxConcurrentRuns=2 且已有 2 个运行中"
      when: "提交第 3 个 run"
      then: "进入排队，空位释放后自动开始"
    - id: AC-007
      given: "会话处于运行中 / 等待确认"
      when: "查看左侧会话列表"
      then: "名称右侧显示对应状态徽标"
    - id: AC-008
      given: "权限 ask 已触发且无人响应"
      when: "经过任意时长"
      then: "不自动拒绝；响应 allow 后任务继续"
    - id: AC-009
      given: "运行中刷新页面"
      when: "重新进入该会话"
      then: "事件流恢复续传，pending ask 仍可响应"
    - id: AC-010
      given: "多个会话运行中"
      when: "server 进程收到 SIGINT/SIGTERM"
      then: "全部 agent destroy 后退出"
    - id: AC-011
      given: "同会话运行中"
      when: "再次 POST /run"
      then: "409"
    - id: AC-012
      given: "config 设置 maxConcurrentRuns"
      when: "经 PATCH/POST /api/config 保存其它字段"
      then: "maxConcurrentRuns 被保留（不抹除）"

  decisions:
    - id: DEC-101
      question: "后台会话卡在权限 ask 时如何处理？"
      selected: "挂起等待，不超时"
      decided_by: human
      reason: "等待零成本（无在途 LLM 调用），配合跨会话提醒不误伤后台任务。取代 SPEC-032 的 120s 超时决策（D-006）"
      status: frozen
    - id: DEC-102
      question: "并发上限缺省值？"
      selected: "maxConcurrentRuns 缺省 3，可配，0=不限"
      decided_by: human
      reason: "防资源失控；日常 2-4 项目并行够用"
      status: frozen
    - id: DEC-103
      question: "托管层级：仅前端维持多连接（L1）还是 server 侧托管（L2）？"
      selected: "server 侧托管（L2）"
      decided_by: human
      reason: "L2 才能满足\"关闭软件才停止\"；L1 关标签页仍会停"
      status: frozen
    - id: DEC-104
      question: "原 FR-21⑤（SSE 断线重连）归属？"
      selected: "吸收进 FR-30"
      decided_by: human
      reason: "同一套\"重挂 + since 续传\"基建，一次做完"
      status: frozen
    - id: DEC-105
      question: "run 提交与订阅的 HTTP 形态？"
      selected: "POST /run 保留（SSE 首订）+ GET /stream?since=N 重挂"
      decided_by: llm
      reason: "web 提交路径零迁移；重挂是纯新增端点"
      status: frozen

  assumptions:
    - id: A-001
      description: "会话列表状态刷新用轮询（~3s，仅有运行中会话时），不建全局 SSE feed（克制）"
      status: inferred
    - id: A-002
      description: "桌面关窗即退（托盘保活不在本期）"
      status: confirmed
    - id: A-003
      description: "事件重放基于 agent.eventHistory$（per-run 全量内存，durable 事件另落盘）；跨 run / 崩溃恢复归 AR-23"
      status: inferred

  open_questions: []
```

## 实现落点（LLM 备注，非规格正文）

- **domain（最小改动）**：① permissions ask 去 120s 超时（PERMISSION_TIMEOUT_MS 移除，abort/stop 即取消路径）；② pendingInteraction 暴露快照查询（供 server 组装 waiting_ask 状态）；③ 事件序号由 server 侧打（domain 事件流不动）。
- **server**：`agentManager.ts`——注册表 / 订阅者管理 / 环形缓冲 / since 续传 / stop / 并发闸（promise 队列）/ SIGINT/SIGTERM 清理 / 状态快照；路由：`GET /stream?since=N`、`POST /stop`、`GET /api/sessions` 加 status。
- **web**：会话列表徽标 + pending ask 全局提醒条 + useAgent 重挂（mount 时查状态，运行中则订阅）。
