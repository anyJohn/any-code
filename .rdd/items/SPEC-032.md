---
id: SPEC-032
type: spec
parent: FE-023
status: approved
owner: human
created: 2026-09-01
persists: permanent
---

# SPEC: 工具权限系统（AR-3 / RR-026 / FE-023）

```yaml
spec:
  id: SPEC-032
  story: FE-023
  status: candidate   # draft → candidate → approved

  behaviors:
    - id: B-001
      description: "每个工具调用在 handler 执行前经权限判定，判定输入为 (工具名, 参数)；判定结果为 allow / ask / deny 三值"
    - id: B-002
      description: "判定顺序：① 用户显式规则（项目级在全局级之后评估，同源内取最后匹配）→ ② 内置危险命令基线（仅 bash，命中即 ask）→ ③ 当前模式的默认策略（按工具类别）"
    - id: B-003
      description: "规则形态为 (工具名, 参数模式) → allow|ask|deny：bash 按命令行 glob/前缀匹配（如 Bash(npm *)），文件类工具（write/edit）按目标路径 glob 匹配（如 Write(src/**)）；其余工具仅按工具名匹配"
    - id: B-004
      description: "出厂默认模式（标准）：bash / write / edit / MCP 工具默认 ask，只读工具（read/grep/glob/explore/use_skill/ask_question/save_memory）默认 allow"
    - id: B-005
      description: "ask 阻塞 agent loop 等待用户裁决，经现有 Interaction 通道（pendingInteractions + Interaction 事件 + POST /interact）；裁决项 = 允许一次 / 永久允许 / 拒绝；超时 120 秒，超时按拒绝处理（B-007），abort 干净退出"
    - id: B-006
      description: "允许一次 → 会话内缓存，key 为工具名+匹配模式（如 Bash(npm *) 放行一次后，同类命令本会话不再问；不落盘，session 结束失效）；永久允许 → 写入规则（默认项目级，UI 可勾选全局）；拒绝 → 不缓存"
    - id: B-007
      description: "拒绝 / 超时的工具调用以 role:tool 结果回传拒绝原因（含工具名与原因），不抛异常、不终止任务，模型可自纠换路"
    - id: B-008
      description: "每次 ask / 裁决 / 硬拦 / 用户规则放行 产生 durable 审计事件（工具名、参数摘要、判定依据、裁决结果），入会话 JSONL，resume 回放可见"
    - id: B-009
      description: "预设模式三档，config 一键切换：标准（出厂默认，B-004：bash/MCP/写全问、只读直通）/ 编辑放行（write/edit 自动放行，bash/MCP 仍 ask——日常干活不被打断）/ 信任（默认策略全 allow，危险基线仍生效）"
    - id: B-010
      description: "Settings 提供权限配置段：模式切换 + 已存规则列表增删（全局与项目两级分开展示）+ 危险命令基线模式增删"
    - id: B-011
      description: "MCP 工具纳入同一引擎：按工具名匹配（无参数模式），未命中走模式默认策略（标准模式下 ask）"
    - id: B-012
      description: "危险命令基线 = 内置默认模式集（rm -rf 变体 / sudo / 磁盘设备写入 / 远程脚本执行 / 计划任务等最小集）+ 用户配置增删（config permissions 段与 Settings 可维护）；命中基线的 bash 命令在任何模式下 ask（用户显式规则可覆盖）"

  constraints:
    - id: C-001
      description: "危险命令基线在信任模式下仍生效（命中即 ask）——全放行不可越过基线；用户显式规则可覆盖基线（显式 allow 某条命令 = 用户知情）"
    - id: C-002
      description: "权限判定不改变既有工具结果契约：拒绝也走 role:tool 消息，agentLoop 调用方签名不变"
    - id: C-003
      description: "规则文件缺失/损坏 → fail-safe：按当前模式默认策略判定 + 发 Warning 事件，不阻断 agent 启动"
    - id: C-004
      description: "会话内缓存不跨 session、不落盘；进程级而非全局单例（per-agent 隔离，与 EventStream 同生命周期）"
    - id: C-005
      description: "非 web 端（TUI/桌面 CLI）无裁决 UI 时，ask 沿用 Interaction 超时语义：超时按拒绝处理（B-007），不新增通道"

  invariants:
    - id: I-001
      description: "任何工具执行必经权限判定，不存在绕过路径（toolCall 是唯一分发点）"
    - id: I-002
      description: "判定为 deny 的调用永不执行 handler"
    - id: I-003
      description: "任何 ask 与裁决可从会话日志重建（durable 审计），崩溃后 resume 不丢裁决历史"

  acceptance_criteria:
    - id: AC-001
      given: "标准模式、未配置任何规则"
      when: "agent 调用 bash"
      then: "产生 PermissionAsked 审计事件并阻塞等待裁决，UI 弹裁决窗"
    - id: AC-002
      given: "用户在裁决窗选择永久允许 Bash(npm *)（默认项目级）"
      when: "agent 后续执行 npm install / npm run build"
      then: "直通执行，无 ask；规则写入项目级规则文件"
    - id: AC-003
      given: "全局规则 deny Bash(*)，项目级规则 allow Bash(npm *)"
      when: "agent 执行 npm run build 与 rm -rf /tmp/x"
      then: "npm run build 放行（项目级后匹配覆盖全局）；rm -rf 无用户规则命中 → 危险基线 ask"
    - id: AC-004
      given: "信任模式、无用户规则"
      when: "agent 执行 bash 命令且命中危险命令基线（如 rm -rf）"
      then: "仍走 ask；未命中基线的命令直通"
    - id: AC-005
      given: "ask 等待中用户选择拒绝"
      when: "裁决返回"
      then: "工具结果为拒绝说明（role:tool），任务继续，模型收到原因；拒绝不写入缓存不写规则"
    - id: AC-006
      given: "ask 等待超时（无裁决通道或用户无响应）"
      when: "超时触发"
      then: "等同拒绝（B-007），产生审计事件记录 timeout"
    - id: AC-007
      given: "标准模式"
      when: "agent 调用只读工具（如 grep）"
      then: "直通执行，不产生 ask，无裁决弹窗"
    - id: AC-008
      given: "write 调用路径匹配用户规则 Write(src/**) allow"
      when: "agent 写 src/a.ts 与 docs/b.md"
      then: "src/a.ts 直通；docs/b.md 未命中 → 模式默认 ask"
    - id: AC-009
      given: "项目级规则文件损坏"
      when: "agent 启动并执行 bash"
      then: "发 Warning 事件，按标准模式默认策略判定（ask），agent 不崩溃"
    - id: AC-010
      given: "用户在 Settings 将模式切到信任"
      when: "下一条消息发起任务（per-request agent 新建）"
      then: "新 agent 读到新模式，bash 非基线命令直通"
    - id: AC-011
      given: "MCP server 暴露工具 mcp_x，标准模式无规则"
      when: "agent 调用 mcp_x"
      then: "走 ask（按工具名，无参数模式）"
    - id: AC-012
      given: "会话 A 中允许一次 Bash(ls)"
      when: "新开会话 B 后执行 Bash(ls)"
      then: "B 会话重新 ask（会话缓存不跨 session）"

  open_questions: []

  decisions:
    - id: D-001
      question: "出厂默认模式"
      selected: "命令+写入询问（bash/write/edit/MCP ask，只读 allow）"
      decided_by: human
      reason: "Claude Code 式成熟平衡点；非只读必经同意，只读不打扰"
      status: frozen
    - id: D-002
      question: "规则匹配粒度"
      selected: "工具名+参数模式（bash 命令 glob/前缀、文件路径 glob）"
      decided_by: human
      reason: "opencode/Claude Code 同构；'允许 npm 禁止 rm'的常见诉求需要参数级"
      status: frozen
    - id: D-003
      question: "裁决持久化"
      selected: "两级可写，默认项目级，弹窗可勾全局"
      decided_by: human
      reason: "权限随项目上下文最自然；全局用于跨项目通用偏好"
      status: frozen
    - id: D-004
      question: "首版交互端"
      selected: "web 先行，他端超时按拒绝降级"
      decided_by: human
      reason: "web 是主力入口；TUI 补 interact 通道成本高，降级语义已有先例"
      status: frozen
    - id: D-005
      question: "危险命令基线维护方式"
      selected: "配置可增：内置默认集起步，config/Settings 可增删模式"
      decided_by: human
      reason: "用户可按自身环境调整护栏范围，不受硬编码限制"
      status: frozen
    - id: D-006
      question: "权限 ask 超时时长"
      selected: "120 秒，超时按拒绝"
      decided_by: human
      reason: "裁决是轻交互，长超时挂住任务；独立于 ask_question 的 10 分钟"
      status: frozen
    - id: D-007
      question: "会话内允许一次的缓存 key"
      selected: "工具名+匹配模式"
      decided_by: human
      reason: "与规则模型同构；裁决时展示的匹配模式即缓存粒度，同类命令不再重复打断"
      status: frozen
    - id: D-008
      question: "预设档位集合"
      selected: "标准 / 编辑放行 / 信任 三档（原'全部询问'档因与标准档语义重合废除）"
      decided_by: human
      reason: "每档意图独立：安全默认 / 日常顺滑（写自动过、命令受控）/ 完全放手；Claude Code 模式同构（plan 档归 FR-12）"
      status: frozen

  assumptions:
    - id: A-001
      description: "MCP 工具在标准模式下默认 ask"
      status: inferred
    - id: A-002
      description: "判定 seam 在 toolCall 单点，agentLoop/工具 handler 无感知"
      status: confirmed
    - id: A-003
      description: "权限配置热更沿用 per-request 语义（下条消息生效），不引入运行中 agent 的规则热加载"
      status: inferred
    - id: A-004
      description: "项目级规则文件为 <ws>/.anycode/permissions.yaml（沿 mcp.yaml 先例：项目级独立 YAML 文件）"
      status: inferred
```

## 实现要点（Non-normative，供拆 TK 参考）

- 判定 seam：toolCall 分发处；deny/超时/拒绝统一走"结果回传"路径。
- ask 复用 pendingInteractions 原语（与 ask_question 并存，事件类型区分）。
- 规则引擎为纯函数（输入 rules + tool + args → verdict），单测友好；危险基线为内置规则集常量。
- 拒绝类结果文案需对 LLM 可自纠（说明原因 + 建议改写）。
