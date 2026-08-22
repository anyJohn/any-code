---
id: SPEC-006
type: spec
parent: FE-006
status: approved
created: 2026-08-22
approved: 2026-08-22
persists: permanent
scope: MCP 真协议连接（stdio + SSE，per-agent，官方 SDK）
---

# SPEC-006: MCP 真协议连接

## behaviors
- B-001: `loadMcpTools`（domain/src/mcp.ts）升级为真 client：对 `.anycode/mcp.json` 每个配置的 server 建连接，用 SDK `list_tools` 拿工具 schema，包装成 `Tool`（schema + handler），handler 经连接 `call_tool` 转发
- B-002: stdio 与 SSE 两种传输都支持（按 server 配置 type 选 transport）
- B-003: 连接 per-agent：agent 创建时建连，`agent.destroy()` 时清理（kill stdio 子进程 / 关 SSE 连接），与 RR-002 连接持有 agent 一致
- B-004: `.anycode/mcp.json` 新格式——每个 server 一个对象，`type: "stdio"|"sse"`，stdio 带 `command`/`args`/`env`，sse 带 `url`/`headers`
- B-005: MCP 工具纳入 agent 工具集（`allTools + mcpTools`），LLM 调用时经现有 `toolCall`（tools/toolCall.ts）按 name 派发，派发侧不变；TOOL 事件照常提交

## constraints
- C-001: 用官方 `@modelcontextprotocol/sdk`（Client + StdioClientTransport + SSEClientTransport）— status: confirmed (DEC-019)
- C-002: 连接 per-agent，`agent.destroy()` 清理（kill 子进程 / 关连），不跨 agent 存活 — status: confirmed (DEC-017)
- C-003: mcp.json 新格式覆盖（type + stdio/sse 字段），旧静态 schema 格式不再支持（不识别即标错跳过该 server）— status: confirmed (DEC-018)
- C-004: stdio + SSE 两种 transport 都实现 — status: confirmed (DEC-016)
- C-005: MCP 工具 handler 经连接 `call_tool` 转发；调用超时/失败回传错误内容（`[Error] ...`）作 tool message，不抛异常中断 agentLoop（与 toolCall 未知工具处理一致）— status: inferred
- C-006: Web 模式下 MCP stdio 子进程随 agent destroy 一起 kill；开发服务器仅监听 127.0.0.1（已有），不暴露公网 — status: inferred（由 C-002 推导，待确认）
- C-007: MCP 工具暂不纳入权限策略（走 TOOL 事件拦截点但无策略），P1 权限策略层统一覆盖 — status: inferred/default
- C-008: 单个 server 连接失败（spawn 失败 / list_tools 报错）不阻断其余 server 与 agent 启动——跳过该 server，记日志 — status: inferred

## invariants
- I-001: MCP 连接不跨 agent 存活（无连接池/缓存，与 RR-002 去 pool 一致；关连接=连停）— status: confirmed
- I-002: MCP 工具调用失败不中断 agentLoop（回传错误内容让模型自纠）— status: confirmed
- I-003: 无 mcp.json 或 server 列表为空时 agent 正常工作（仅内置工具）— status: confirmed

## acceptance_criteria（即测试契约）
- AC-001 (stdio 连接): given mcp.json 配一个 `{ type: "stdio", command, args, env }` server, when AnyAgent 创建（或 loadMcpTools 执行）, then 用 StdioClientTransport spawn 子进程建连，`list_tools` 返回的工具注册成 `Tool`（schema + handler）加入 agent 工具集
- AC-002 (SSE 连接): given mcp.json 配一个 `{ type: "sse", url, headers }` server, when AnyAgent 创建, then 用 SSEClientTransport 建连，`list_tools` 工具注册成 `Tool`
- AC-003 (工具调用转发): given LLM 产 tool_calls 含某 MCP 工具名, when `toolCall` 派发, then 该 Tool handler 经连接 `call_tool` 转发到 server，返回结果作为 tool-role message；server 报错/超时则回传 `[Error] ...` 内容，不抛异常、不中断 agentLoop
- AC-004 (生命周期清理): given agent 持有 MCP 连接, when `agent.destroy()`, then kill stdio 子进程 / 关 SSE 连接，无残留进程或连接泄漏
- AC-005 (新格式): given mcp.json 用新格式（type + 对应字段）, when loadMcpTools 读, then 按 type 选 transport；旧静态 schema 格式（无 type 字段）不识别，该 server 跳过并记错
- AC-006 (无 server): given mcp.json 为空或不存在, when AnyAgent 创建, then 不建连、不报错，agent 仅用内置工具正常工作
- AC-007 (TOOL 事件): given MCP 工具执行, when 完成, then `ctx.eventStream.submit` 提交 TOOL 事件 `{ name, args, result, turnId }`，与内置工具一致
- AC-008 (单 server 失败不阻断): given mcp.json 配 2 个 server 其中第 1 个 spawn 失败, when loadMcpTools, then 第 1 个跳过记错，第 2 个正常建连注册，agent 启动不中断

## open_questions（非 blocking，deferred 下轮）
- Q-002a Web 模式 stdio spawn 的进一步安全限制（C-006 inferred 待确认）
- Q-002b MCP 工具权限策略（C-007 默认放行，待 P1）
- Q-002c server 连接超时阈值与重连策略（C-005 inferred）
- Q-002d list_tools 后工具名与内置工具重名时的命名空间（mcp__ 前缀？待定）

## decisions (frozen)
- DEC-016: stdio + SSE 两种 transport 都实现（第一轮都上）
- DEC-017: 连接 per-agent——agent 创建时建连，destroy 时清理；与 RR-002 连接持有一致，关连接=连停
- DEC-018: mcp.json 新格式覆盖（type: stdio|sse + 对应字段），旧静态 schema 不再支持（不识别即跳过记错）
- DEC-019: 用官方 @modelcontextprotocol/sdk（Client + StdioClientTransport + SSEClientTransport）

## assumptions
- A-001: 用 v1 `@modelcontextprotocol/sdk@1.30.0`（已验：包存在，`./client` 子路径导出 Client + StdioClientTransport + SSEClientTransport + listTools/callTool，标准 v1 API）。v2 `@modelcontextprotocol/client@2.0.0`（拆包、2026-07-28 新 spec、刚发布）留作未来迁移 — status: confirmed（包+子路径已验；具体符号名按实际 v1 API 调用）
- A-002: 测试策略——单测 mock `@modelcontextprotocol/sdk/client`（vi.mock），不需真 spawn server；AC-001/002/003/008 用 mock 验控制流，AC-004 验 destroy 调 cleanup，AC-006 验空配置路径 — status: inferred
- A-003: MCP 工具 schema 来自 server `list_tools`，handler 闭包捕获对应连接 — status: inferred

## future (deferred)
- MCP 工具权限策略 → 与 P1 权限策略层统一（C-007）
- 工具名命名空间（mcp__ 前缀）防与内置工具重名 → Q-002d 下轮
- server 热重载 / 运行时增删 server → 非本 SPEC
- resources/prompts（MCP 除 tools 外的能力）→ 非本 SPEC，仅 tools
