---
id: SPEC-009
type: spec
parent: FE-009
status: approved
created: 2026-08-22
approved: 2026-08-22
persists: permanent
scope: Web 配置面板 + 配置写回 + 热更新（MCP 配置收敛进 config.yaml）
---

# SPEC-009: Web 配置面板 + 热更新

## 配置文件形态（扩展，.anycode/config.yaml）

```yaml
providers:
  openai:
    apiKey: sk-xxx
    baseURL: https://api.openai.com/v1
    model: gpt-4o
    streaming: true
  deepseek:
    apiKey: sk-d
    model: deepseek-chat
default: openai
mcp:                          # MCP server 配置收敛于此（mcp.json 废弃）
  filesystem:
    type: stdio
    command: npx
    args: [-y, "@modelcontextprotocol/server-filesystem", /tmp]
  remote:
    type: sse
    url: https://example.com/sse
    headers: { Authorization: "Bearer xxx" }
```

## behaviors
- B-001: config.yaml 扩展 `mcp:` 段（server map，type stdio/sse + 字段，同 FE-006 mcp.json 形态）；Config.load 解析 mcp → `Config.mcpServers`
- B-002: `loadMcpTools` 从 `Config.mcpServers` 读（不再读 mcp.json）；mcp.json 废弃
- B-003: Web `/settings` 独立页（侧栏底部入口），查看/编辑 providers + default + streaming + mcp servers
- B-004: `GET /api/config?workspaceKey=...` 返回配置（apiKey 脱敏）；`POST /api/config` 写回 config.yaml + 校验
- B-005: 热更新——写 config 后下次 `/run` 的 `AnyAgent.create` 读新 config（providers + mcp 都生效；MCP 按新 mcp 段重连），无需重启服务
- B-006: apiKey 脱敏——GET 返回 `sk-x...xxx`（前4后4）；POST 时空 apiKey = 保留原值（不改）

## constraints
- C-001: /settings 独立页 + 侧栏底部入口（DEC-029）— status: confirmed
- C-002: MCP 配置收敛进 config.yaml `mcp:` 段，mcp.json 废弃；loadMcpTools 改读 Config.mcpServers（DEC-030）— status: confirmed
- C-003: GET/POST /api/config；POST 写 config.yaml + 校验（providers 非空、default 存在、mcp server type 合法）（DEC-031）— status: confirmed
- C-004: apiKey GET 脱敏（前4后4），POST 空值=保留原值（DEC-032）— status: confirmed
- C-005: 热更新靠 AnyAgent.create 时 Config.load + initMcp 读新配置（连接持有模型，下次 /run 自动生效）— status: confirmed
- C-006: 写 config.yaml 用 YAML 序列化（js-yaml dump），保留结构 — status: inferred

## invariants
- I-001: config.yaml 是唯一配置源（providers + default + mcp），无 .env / 无 mcp.json — status: confirmed
- I-002: 中 /run 改配置不影响当前任务（ctx.llm + mcp tools 已加载），下次 /run 生效 — status: confirmed
- I-003: apiKey 不以明文经 GET 返回（脱敏）— status: confirmed

## acceptance_criteria（即测试契约）
- AC-001 (config mcp 段): given config.yaml 含 `mcp:` 段, when `Config.load`, then `mcpServers` 解析为 map（含 type/字段）
- AC-002 (loadMcpTools 从 Config 读): given Config.mcpServers, when `loadMcpTools(mcpServers)`, then 用 mcpServers 建 stdio/sse 连接（不再读 mcp.json）
- AC-003 (GET /api/config): given workspace config.yaml, when GET /api/config, then 返回 providers/default/mcp，apiKey 脱敏（sk-x...xxx）
- AC-004 (POST /api/config 写+校验): given 合法配置 JSON, when POST /api/config, then 写 config.yaml + 200；非法（providers 空 / default 不存在 / mcp type 非法）→ 400 + 错误信息
- AC-005 (热更新): given 改 config（providers 或 mcp）, when 下次 /run AnyAgent.create, then 用新 providers + 新 mcp（MCP 按新配置重连）
- AC-006 (apiKey 保留): given POST 时某 provider apiKey 空, when 写回, then 该 provider 保留原 apiKey（不改）
- AC-007 (/settings UI): given 访问 /settings, when 渲染, then 展示 providers/default/streaming/mcp 编辑表单；侧栏底部有入口链接

## open_questions（非 blocking，deferred 下轮）
- Q-009a config.yaml 写回是否保留注释（js-yaml dump 丢注释）— inferred（丢注释，可接受；或后续用 yaml AST 保注释）
- Q-009b 多工作区配置切换 / 工作区级 vs 全局 config — deferred
- Q-009c 配置版本 / 备份（写前备份旧 config）— deferred

## decisions (frozen)
- DEC-029: 独立 /settings 页 + 侧栏底部入口
- DEC-030: MCP 配置收敛进 config.yaml `mcp:` 段（mcp.json 废弃）；loadMcpTools 改读 Config.mcpServers；热更新=下次 /run initMcp 读新配置自动重连
- DEC-031: GET/POST /api/config；POST 写 config.yaml + 校验（providers 非空 / default 存在 / mcp type 合法）
- DEC-032: apiKey GET 脱敏（前4后4，sk-x...xxx）；POST 空值=保留原值

## assumptions
- A-001: loadMcpTools 签名改为 `(mcpServers: Record<string, ServerConfig>)` 或从 Config 取；AnyAgent.initMcp 用 `this.config.mcpServers` — status: inferred
- A-002: /api/config 端点放 web/app/api/config/route.ts；读写用 domain Config / fs — status: inferred
- A-003: 测试——config.test 加 mcp 段解析；mcp.test 改传 mcpServers（不写 mcp.json）；web 加 /api/config 端点测 + /settings 组件测 — status: inferred

## future (deferred)
- config.yaml 注释保留（Q-009a）
- 多工作区配置切换（Q-009b）
- 配置备份（Q-009c）
- MCP server 连通性探测 → FE-012 状态面板
