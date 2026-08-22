---
id: SPEC-005
type: spec
parent: FE-005
status: approved
created: 2026-08-22
approved: 2026-08-22
persists: permanent
scope: 核心路径单测（首轮 agentLoop + toolCall）
---

# SPEC-005: 核心路径单测（首轮 agentLoop + toolCall）

## behaviors
- B-001: `agentLoop`（domain/src/core.ts）四条控制流路径有回归测试：有 tool_calls→执行→回灌→循环；无 tool_calls→返回；signal aborted→stopped；达 maxIter→截断不无限循环
- B-002: `toolCall`（domain/src/tools/toolCall.ts）三条路径有回归测试：已知工具按 function name 派发；执行后提交 TOOL 事件；未知/未注册工具不抛异常中断循环
- B-003: domain 包加 vitest 测试基建（test script + 依赖 + domain/test/ 目录），纳入根 `pnpm test`（`pnpm -r test`）

## constraints
- C-001: 测试框架用 vitest（ESM 友好，零配置，与 esbuild/turbo 贴合）— status: confirmed (DEC-012)
- C-002: callLLM 用固定桩 mock（返回预设 tool_calls / content / 按 signal 抛错），不调真 LLM、不依赖网络与 API key — status: confirmed (DEC-013)
- C-003: 首轮只测 agentLoop + toolCall，其余（main 串行/session/eventStream）渐进式补，本轮 AC 只覆盖这两路径 — status: confirmed (DEC-014)
- C-004: 不设覆盖率硬指标门禁，原则"改哪里先补哪里"渐进式 — status: confirmed (DEC-015)
- C-005: 测试文件放 `domain/test/*.test.ts`，纳入根 `pnpm test`（domain package.json 加 `"test": "vitest run"`）— status: inferred（默认配置，可后续调）
- C-006: toolCall 测试用 fake tool（schema + 返回固定 result 的 handler）作 fixture，不依赖真实内置工具实现 — status: confirmed

## invariants
- I-001: 单测只证代码控制流路径存在与正确，**不证"LLM 真会那么做"**（后者属 LLM 行为依赖，需真 LLM run，本 SPEC 不覆盖）— status: confirmed
- I-002: 测试可在无网络、无 API key、无真实文件系统依赖下运行（session store 测试用临时目录，后续轮补）— status: confirmed

## acceptance_criteria（即测试契约）
- AC-001 (agentLoop·tool_calls loop): given callLLM 桩在第 1 次返回带 `tool_calls: [{function: {name: "fakeTool", arguments: "{}"}}]` 的响应、第 2 次返回无 tool_calls 的 content, when `agentLoop(task, messages, maxIter, {}, undefined, ctx, tools)` 执行, then 第 1 次后调用 fakeTool handler、把其结果作为 tool role message push 回 messages、继续第 2 次 callLLM、最终返回 `{ result: <第2次content>, messages }`，messages 含 user/assistant(tool_calls)/tool(result)/assistant(final) 四条
- AC-002 (agentLoop·no tool_calls return): given callLLM 桩返回无 tool_calls 的 content "hello", when agentLoop 执行, then 单次 callLLM 后直接返回 `{ result: "hello", messages }`，不再循环
- AC-003 (agentLoop·abort): given `ctx.signal` 已 aborted（或迭代中 abort）, when agentLoop 进入下一迭代, then 不再调 callLLM，返回 `{ result: "[stopped]", messages }`
- AC-004 (agentLoop·maxIter): given callLLM 桩每次都返回 tool_calls, when maxIter=2 且迭代达上限, then 停止循环并返回（不无限递归/循环）
- AC-005 (toolCall·dispatch): given tool_calls 含已注册 fakeTool, when `toolCall(toolCalls, ctx, tools, turnId)` 执行, then 按 function name 派发到 fakeTool handler，返回 tool-role message 数组 `[{ role: "tool", content: <handler result>, tool_call_id }]`
- AC-006 (toolCall·TOOL event): given tool 执行, when 完成, then `ctx.eventStream.submit` 被调用一次，事件 type=TOOL、`data: { name, args, result }`、`turnId` 正确
- AC-007 (toolCall·unknown tool): given tool_calls 含未注册工具名 "nope", when toolCall 执行, then 返回 tool-role message（content 含 `[Error] Function not found: nope`）加入结果数组，不抛异常、循环不被中断

## open_questions
（首轮 blocking 全已决策，见 decisions；渐进式补其余路径时再开下一批）

## decisions (frozen)
- DEC-012: 测试框架 vitest（vs jest/node:test）— ESM 友好、零配置、与现有 esbuild/turbo 工具链贴合
- DEC-013: callLLM 用固定桩 mock（vs 录制回放 / 真 LLM 冒烟）— 固定桩能证代码控制流；录制回放维护重且脆；真 LLM run 留给 LLM 行为依赖特性（非本 SPEC）
- DEC-014: 首轮范围 agentLoop + toolCall 两核心路径，其余渐进式补 — 快速产出回归网，优先覆盖 RR-003/004 即将动的 core.ts/toolCall.ts
- DEC-015: 不设覆盖率硬指标门禁（vs 设阈值）— 避免"为指标写无用测试"，改哪里先补哪里

## assumptions
- A-001: agentLoop 与 toolCall 的控制流是纯代码路径（非 LLM 行为依赖），mock callLLM 可证路径正确性 — status: confirmed
- A-002: 测试文件放 `domain/test/`、domain package.json 加 `"test": "vitest run"`、根 `pnpm test` 经 `pnpm -r test` 收口 — status: inferred
- A-003: vitest 配置可用默认 glob（`**/*.test.ts`），无需自定义 — status: inferred

## future (deferred)
- main.ts 串行/中断测试、session store 测试、eventStream per-agent 隔离测试 — 渐进式补（DEC-014）
- 真 LLM 冒烟测试（LLM 行为依赖特性）— 非本 SPEC，需时另立 RR
- 纳入 CI / pre-commit — 待 P2 CI/CD 落地
