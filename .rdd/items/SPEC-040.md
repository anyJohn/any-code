---
id: SPEC-040
type: spec
parent: FE-025
status: approved
owner: human
created: 2026-09-16
persists: permanent
---

# SPEC-040: 事件协议表 + Provenance + 命令下沉 + 渲染表驱动

> 用户 2026-09-16 批准开工（"开始重构"）。来源讨论：messages 三分类（需要渲染/无需渲染/替换渲染）
> → 深挖为 document/overlay/sidecar 模型 + provenance 轴 + 命令层归属判据。

```yaml
spec:
  id: SPEC-040
  feature: FE-025
  status: approved

  behaviors:
    - id: B-001
      description: >
        domain 定义单点协议表 PROTOCOL: Record<EventType, { durable: boolean;
        shadowOf?: EventType }>。durable = 入盘（session.jsonl）；shadowOf = 该事件是
        某个 durable 事件的实时影子（AssistantDelta→Assistant，ToolStart/ToolProgress/
        ToolArgProgress→Tool）。DURABLE_TYPES 派生自协议表，不再独立枚举。
    - id: B-002
      description: >
        User 事件与 user message 增加 provenance：origin "human" | "system"。
        命令注入携带结构化 command: { name, args, body }。所有 user 位系统注入
        （命令展开、compact 摘要、plan 反馈）经统一入口，message 落 _meta.origin
        （callLLM 剥离，provider 不可见）。
    - id: B-003
      description: >
        斜杠命令展开下沉 domain：submit("/name args") 在内核边界解析（skill 优先、
        custom commands 次之，不匹配当普通消息）；User 事件 message = 原始输入
        "/name args"（web 乐观插入/去重/↑↓ 历史依赖它），command 字段携带
        {name, args, body}；messages 里的 LLM content = "/name args\n\n<body>"
        （展开格式不变，prompt 行为零变化）。TUI/CLI 免费获得同能力。
    - id: B-004
      description: >
        web 渲染规则表驱动：RENDER_RULES: Record<EventType, { kind: "turn" | "single"
        | "meta" }>，toRenderItems 的 single 列表与 isGroupStart 派生自该表。
        UserBubble 徽标读 event.command（保留旧首行嗅探兜底旧 session）。
        activeTool 内联扫描抽为独立 helper（overlay 收敛第一步）。
    - id: B-005
      description: >
        ↑/↓ 消息历史展示用户原始输入（User 事件 message 即 "/name args"，天然成立）。

  constraints:
    - id: C-001
      description: 落盘格式向后兼容：旧 session.jsonl（无 origin/command 字段）resume 后正常渲染与重发。
    - id: C-002
      description: 既有 web 测试与 golden 行为不回归（双气泡/增量渲染/thinking 计时）。
    - id: C-003
      description: 纯 UI 命令（/compact、/model、/rewind、导航）留 web，不下沉。
    - id: C-004
      description: provider 不可见任何 provenance 元数据（_meta 剥离不变）。

  invariants:
    - id: I-001
      description: shadowOf 指向的目标必须 durable（编译期或等价测试保证）。
    - id: I-002
      description: 凡进入 messages 的 user 位内容必有 origin；human 消息只能源自用户输入通道。

  acceptance_criteria:
    - id: AC-001
      given: 派生 DURABLE_TYPES
      when: 与重构前硬编码集合比对
      then: 逐元素相等（快照测试）
    - id: AC-002
      given: web 输入 /skill_name args 并发送
      when: User 事件到达
      then: message 为原始输入 "/skill_name args"，command={name, args, body}，渲染为徽标+参数+可展开正文；messages 中 LLM content 为展开格式
    - id: AC-003
      given: 同一 skill
      when: 经 use_skill 工具调用
      then: 行为不变（tool result 位置，不迁 user 位）
    - id: AC-004
      given: 旧 session（首行 "/name" 格式、无 command 字段）
      when: reload 渲染
      then: 嗅探兜底正确显示徽标
    - id: AC-005
      given: compact 后的会话
      when: 检查 messages
      then: 合成 user message 带 _meta.origin="system"（LLM 请求中不可见）
    - id: AC-006
      given: 单测 mock LLM 的 skill 展开路径
      when: 跑 domain 全量测试
      then: 通过（AC-002/003/005 有对应单测）

  decisions:
    - id: DEC-144
      question: 命令展开放哪层
      selected: domain submit 边界（判据：会变成对话里一条消息的命令属内核）
      decided_by: human
      reason: provenance 单点 + 三入口同语义 + 历史不被展开文污染
      status: frozen
    - id: DEC-145
      question: 渲染分组知识与持久化知识是否同表
      selected: 分两层：协议表在 domain（durable/shadowOf），渲染规则表在 web（turn/single/meta）
      decided_by: human
      reason: durable 是协议事实，turn/single 是 web 排版选择，domain 不该知道排版
      status: frozen
    - id: DEC-146
      question: 徽标数据来源
      selected: User 事件结构化 command 字段，旧格式嗅探仅作兼容兜底
      decided_by: human
      reason: 消灭字符串魔法协议
      status: frozen
    - id: DEC-147
      question: custom command 展开格式（旧格式 body 在前、参数在后、单换行）
      selected: 统一为新格式 "/name args\n\n<body>"（与 skill 同构，评审后用户决策 2026-09-16）
      decided_by: human
      reason: 获得 command 结构化标记与徽标；一套展开逻辑；存量 custom 的 prompt 形态变化可接受
      status: frozen
```
