---
id: SPEC-034
type: spec
story: RR-027
parent: RR-027
status: completed
owner: human
created: 2026-09-04
persists: permanent
origin: 用户决策 2026-09-03/04（会话内指令）
---

# SPEC: 内置连接器废除 → 原生 web 工具 + 全局代理 + 通用工具开关

> 场景 B（整体替换）：SPEC-031 的 ability 注册层（bundled stdio MCP server）被本 spec
> **取代**——旧"内置能力"（web-fetch / web-search / browser-use 连接器）不复存在，
> 其能力以原生工具形态重实现。SPEC-031 中与连接器注册/开关/目录注入相关的 behavior
> 一并作废；其技能 seed 部分不受影响。

## 决策（人类，2026-09-03/04 会话）

- DEC-111：**取消内置 MCP 设计**——web_fetch / web_search / browser_* 做成原生 Tool（无 stdio 子进程、无 mcp__ 前缀）。
- DEC-112：**通用工具开关与配置**——所有工具（含扩展/MCP 注入的）支持 enabled 开关 + 私有配置（`config.tools` 段）。
- DEC-113：**全局出网代理**——`config.proxy` 单一来源，所有联网操作（LLM / web 工具 / MCP SSE）统一走它；不做每工具代理。

```yaml
spec:
  behaviors:
    - { id: B-001, description: "web_fetch/web_search 为原生 Tool（readOnly+concurrencySafe），配置经 ctx.toolsConfig 注入" }
    - { id: B-002, description: "browser_navigate/content/eval 原生 CDP 工具（全局 WebSocket，/json/list 自动发现 page），非只读→标准模式 ask" }
    - { id: B-003, description: "config.tools.<名>.enabled===false → 该工具从注册表剔除（LLM 不可见）；未配置 = 启用；对扩展/MCP 工具同样生效" }
    - { id: B-004, description: "config.proxy 设置后经 undici setGlobalDispatcher(EnvHttpProxyAgent) 全局生效——LLM 调用、web 工具、MCP SSE、模型探测全部经代理；noProxy 豁免；本地回环始终直连" }
    - { id: B-005, description: "旧 config.abilities 段 load 时迁移到 tools（web-fetch→web_fetch、web-search→web_search、browser-use→browser_* 三键），tools 显式条目优先；保存不再写出 abilities" }
    - { id: B-006, description: "桌面端启动经 Electron session.resolveProxy 探测系统代理，注入标准 https_proxy env（仅未设时）；SOCKS 探测结果提示改用 HTTP 端口" }
    - { id: B-007, description: "web 工具超时 15s（web_fetch 可 config.timeoutMs 调小）；搜索失败为非终态错误文案（模型自纠），不终止 run" }
  constraints:
    - { id: C-001, description: "外部用户配置 MCP（config.mcp / 项目 mcp.yaml）行为不变" }
    - { id: C-002, description: "domain 禁止在工具层实现代理——代理只经 netProxy 全局 dispatcher（单一来源）" }
  acceptance_criteria:
    - { id: AC-001, given: "env 代理 + DDG 直连被墙", when: "web_search 调用", then: "经全局 dispatcher 返回搜索结果（直连必挂场景修复）" }
    - { id: AC-002, given: "真 headless chromium CDP 端点", when: "browser_navigate → browser_content → browser_eval", then: "导航/读正文/eval 全通（原 browserTool.test 3 例）" }
    - { id: AC-003, given: "config.tools.bash.enabled=false", when: "agent 组装工具集", then: "bash 不在 LLM 工具列表" }
    - { id: AC-004, given: "旧 config.yaml 含 abilities 段", when: "load + save", then: "开关/配置迁移到 tools 段且 abilities 不再写出" }
```

## 实现落点

- domain：`tools/functions/{webFetchTool,webSearchTool,browserUseTool,webHttp}.ts`；`netProxy.ts`（undici EnvHttpProxyAgent 全局 dispatcher）；`config.ts` tools/proxy/noProxy + 迁移；删 `abilities.ts`、`builtin.ts` 注册层、`builtin/{web-fetch,web-search,browser-use}/`
- server：GET/POST/PATCH /api/config abilities 块 → tools catalog/config；保留 proxy/noProxy
- web：AbilitiesCard → ToolsCard（全量工具开关 + web_search provider/apiKey + browser cdpUrl）
- desktop：main.ts 启动时 resolveProxy 探测系统代理 → 注入 https_proxy env
