---
id: SPEC-042
type: spec
parent: FE-026
status: candidate
owner: human
created: 2026-09-16
persists: permanent
---

# SPEC-042: 用量面板 + 状态栏性能指标

```yaml
spec:
  id: SPEC-042
  feature: FE-026
  status: candidate

  behaviors:
    - id: B-001
      description: >
        llm.ts 捕获扩展指标：cached_tokens（resp.usage.prompt_tokens_details.cached_tokens，
        流式末片同源）、ttft_ms（流式请求发出 → 首个 delta chunk）、duration_ms（请求发出 →
        末片/完成）。全部可选字段——provider 未报/非流式无 ttft 时字段缺省。
    - id: B-002
      description: >
        Usage 事件 data 扩展（cached_tokens?/ttft_ms?/duration_ms?，镜像 web sseEvents）；
        可选字段向后兼容（旧事件缺省，C-001）。
    - id: B-003
      description: >
        用量账本：server 侧对每条 durable Usage 事件追加一行原始记录
        （ts/sessionId/model/prompt/completion/cached?/ttft?/duration?，按工作区
        ~/.anycode/projects/<projectKey>/usage.jsonl）。只增不改；不存费用——
        费用在显示时点按当时 pricing 换算。
    - id: B-004
      description: >
        StatusBar 实时指标：上下文用量/会话累计（现状保留）+ 最新一次调用的
        TTFT、生成速度（completion_tokens/duration_ms）、缓存命中率
        （cached/prompt，有 cached 数据才显示，DEC-151）。
    - id: B-005
      description: >
        用量面板（StatusBar 点击弹出，模式同 SnapshotsDialog），统计视图（2026-09-16
        用户反馈升级：原"逐轮日志"形态不够）：① 周期汇总 stat tiles（今日/本月/总计，
        tokens+费用+命中率）；② 日（近30天）/月（近12月）堆叠柱图（series=模型，
        颜色跟随实体固定指派，第 6+ 折入 Other，hover tooltip 按模型分解）；③ 按模型
        分布横条（直接标签）；④ 逐轮明细默认折叠（表格视图兜底 + AC-004）。
        聚合纯函数 web/lib/usageStats.ts（usageStats.test.ts 钉口径）。

  constraints:
    - id: C-001
      description: 向后兼容：旧 session 的 Usage 事件（无新字段）渲染与聚合不报错、命中项按缺省隐藏。
    - id: C-002
      description: 账本写入失败不阻断对话（审计类旁路，同 snapshot/权限审计模式）。
    - id: C-003
      description: web 不直接读账本文件——经 server API（GET /api/workspaces/:key/usage）。

  invariants:
    - id: I-001
      description: 账本只增不改不删；费用永远显示时点换算，不入账本。

  acceptance_criteria:
    - id: AC-001
      given: 流式调用（provider 报 cached_tokens）
      when: Usage 事件到达
      then: 携带 cached_tokens/ttft_ms/duration_ms；StatusBar 显示命中率/速度/TTFT
    - id: AC-002
      given: provider 不报 cached_tokens
      when: StatusBar/面板渲染
      then: 命中率项隐藏，其余指标正常（无 NaN/undefined 外漏）
    - id: AC-003
      given: 一个会话多轮对话
      when: 打开用量面板
      then: 逐轮明细与会话汇总一致；跨会话累计含本会话（账本已落行）
    - id: AC-004
      given: 旧 session（Usage 事件无新字段）
      when: 重放/打开面板
      then: 正常渲染，缺省字段显示 "—"
    - id: AC-005
      given: 账本文件不可写（权限/磁盘）
      when: 对话继续
      then: 对话不受影响，账本缺行（warning 日志）
    - id: AC-006
      given: 无 pricing 配置
      when: 面板渲染
      then: 费用列隐藏，token 数正常（与 StatusBar 现有行为一致）

  open_questions:
    - id: Q-001
      question: sub-agent（author 标记）的 Usage 事件是否入账本？
      options: [入账本并带 author 列, 账本只记主循环（sub-agent 用量经父循环的 Usage 已含）]
      selected: 入账本并带 author 列
      decided_by: human
      status: resolved
    - id: Q-002
      question: 用量面板入口形态
      options: [StatusBar 点击弹出对话框（模式同 SnapshotsDialog）, 新增主区第五 tab]
      selected: StatusBar 点击弹出对话框
      decided_by: human
      status: resolved

  decisions:
    - id: DEC-152
      question: sub-agent 用量入账本口径
      selected: 入账本并带 author 列（主 agent 空 / sub-agent 名）
      decided_by: human
      reason: 数据完整性最好，成本一行
      status: frozen
    - id: DEC-153
      question: 用量面板入口形态
      selected: StatusBar 点击弹窗（模式同 SnapshotsDialog），不加主区 tab
      decided_by: human
      reason: 主区四 tab 结构不动，避免与右栏重构立项冲突
      status: frozen

  assumptions:
    - id: A-001
      description: 主流 OpenAI 兼容 provider（含 DeepSeek）流式末片 usage 带 prompt_tokens_details.cached_tokens；未带者走降级显示
      status: inferred
    - id: A-002
      description: 账本按行追加 JSONL，量级（每行 ~150B × 每轮 1 行）长期可忽略，无需轮转
      status: inferred
```
