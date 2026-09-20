---
id: SPEC-043
story: RR-032
status: approved
owner: human+agent
created: 2026-09-17
---

# SPEC-043: 全链路多模态 + 热会话缓存

## 范围

RR-032 两部分：
1. 多模态链路（协议/agent 读图/用户贴图上传/@ 选取）；
2. 热会话缓存（AgentManager LRU，消 per-run 三段初始化）。

## Decisions（frozen）

- DEC-154 视觉能力检测：provider 配置加 `vision?: boolean`。发视觉消息时模型无 vision → 图片块降级为 `[图片: 文件名]` 文本占位 + Warning 事件提示。`decided_by: human`（Q1=A）
  - **DEC-159 修订（2026-09-20，supersedes DEC-154 的缺省值）**：`vision` 缺省由 `false` 改为 **`true`（未声明 = 支持）**，仅显式 `vision: false` 才走文本占位降级。缺省翻开后的兜底：未声明而模型实际不支持 → provider 4xx 拒绝 image_url 块 → agentLoop 捕获（`isImageUnsupportedError`）后把带图消息整体替换为文本占位、置 `ctx.vision = false`、发 Warning、同轮重试一次（只降级一次，再失败上抛）。设置页模型行开关默认开启。`decided_by: human`（本会话确认）
- DEC-155 上传落点：工作区根目录，重名加后缀 `name(1).png`。`decided_by: human`（Q2=A）
- DEC-156 大小限制：上传单文件 ≤10MB 拒绝超限；入库前归一化（长边 ≤2000px，JPEG 重压梯度）——对齐 opencode（photon 方案不用，纯尺寸检查 + 可选 sharp；无 sharp 时仅校验不缩放）。`decided_by: human`（Q3=A + 调研修正）
- DEC-157 落盘形态：data URL base64 **内联** session.jsonl（对齐 opencode）；入库前过 DEC-156 归一化控制体积。`decided_by: human`（Q4=A，调研后加归一化约束）
- DEC-158 热会话缓存：AgentManager 增 LRU（run 终态不立即 destroy，保留 5min，同会话连续 run 复用内存态 agent；容量 8，满了逐最旧）。`decided_by: human+agent`（本会话确认）

## Behaviors

- B-001 协议层：ChatMessage（OpenAI ChatCompletionMessageParam）天然支持 parts；callLLM 不改 payload 结构（messages 透传）。
- B-002 agent 读图：read 工具遇图片扩展名 → {type:"image_url", image_url:{url:"data:...;base64,..."}} 内容块作为 tool result 的**附加部分**（文本结果保留 + 合成 user 消息注入图片块，OpenAI 兼容层 tool result 不支持多模态——对齐 pi/opencode 做法）。
- B-003 用户贴图：web 输入框支持粘贴/选择图片 → chip 显示 → 发送时转 data URL parts。
- B-004 desktop 上传文件到工作区：POST /api/workspaces/:projectKey/upload（multipart），落工作区根（DEC-155），≤10MB（DEC-156）。
- B-005 @ 选取图片：useFileReference 列表含图片文件；发送时图片 chip 转 data URL parts（不是拼路径）。
- B-006 视觉降级：模型**显式** `vision: false`（DEC-154）→ parts 中 image_url 块替换为文本占位 + Warning。缺省（未声明）视为支持（DEC-159）。
- B-008 图片被拒兜底（DEC-159）：未声明 vision 而 provider 以 4xx 拒绝 image_url → 去图转文本占位 + `ctx.vision=false` + Warning + 同轮重试一次。
- B-007 热缓存命中：同会话连续 run → 复用 agent（跳过 resume/config/mcp 三段初始化）；缓存 agent 的 config 与磁盘 config.yaml 热更语义：新 run 不重读（可接受，DEC-158 简化）。

## Constraints

- C-001 落盘体积：单条消息含图片 data URL 总量 ≤8MB（归一化后）；超限拒发并提示。
- C-002 回放兼容：session.jsonl 含多模态消息时 /history 与 reload 不崩（旧代码读新数据 = 兼容性红线）。
- C-003 热缓存安全：缓存 agent 必须与 run 终态一致（无在途任务）；stop()/权限 ask 挂起时不可入缓存。
- C-004 上传路径安全：上传文件名经 sanitize（防 ../ 逃逸），落在工作区内。

## Invariants

- I-001 显式声明非视觉（`vision: false`）的模型收到的消息永不包含 image_url 块（B-006 兜底）。
  未声明视力的模型若被 provider 拒绝图片，必须经 B-008 去图后重试——不得把带 image_url 的请求原样反复重发。
- I-002 热缓存复用 agent 的 eventStream$ 订阅必须完全重置（上次 run 的订阅残留 = 事件串流 bug）。

## Acceptance Criteria

- AC-001 given 视觉模型+用户贴图 when 发送 then LLM 请求 messages 含 image_url 块（data URL）。
- AC-002 given 显式 `vision: false` 模型+贴图 when 发送 then 请求中无 image_url，含文本占位，事件流出现 Warning。
- AC-002b given 未声明 vision 的模型+贴图 when provider 以 4xx 拒绝图片 then 去图转文本占位 + Warning + 同轮重试成功（DEC-159）。
- AC-002c given 去图后仍失败 when 再次拒绝 then 上抛原错误（降级只做一次，不循环）。
- AC-003 given 工作区有图片 when read 该图片 then tool result 文本 + 后续 user 消息含图片块（视觉模型）。
- AC-004 given 上传 12MB 文件 when POST upload then 413 拒绝。
- AC-005 given 上传 normal.png 已存在 when 再传同名 then 落盘 normal(1).png。
- AC-006 given 含图片消息的会话 when reload /history then 前端渲染图片（不崩）。
- AC-007 given 同会话 run A 结束后 3min 内 run B when 提交 then 不触发 store.load（热缓存命中，日志/断言验证）。
- AC-008 given 缓存容量 8 满 when 第 9 个会话入缓存 then 最旧被逐出并 destroy。
- AC-009 given run A 权限 ask 挂起时用户 stop when 终态 then agent 不入缓存（C-003）。

## Open Questions

（无——blocking 均已决）
