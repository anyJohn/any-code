---
id: SPEC-031
parent: FE-022
status: approved
persists: permanent
---

# SPEC: 内置能力体系（abilities + 四层技能 + 目录注入 + AGENTS.md 规则）

场景：B（整体替换——skills 加载机制重写、rules 机制退役）。旧行为仅作回归基线，标 superseded，不做 Spec Reconstruction。

## Behaviors

| id | description |
|---|---|
| B-001 | abilities 注册器：`registerAbility(Ability)`；**同一层注册重名能力 → throw**（copy deepseek fail-fast） |
| B-002 | 启用决议：`enabled = config.abilities?.[name]?.enabled ?? false`（**未配置 = 不启用**）；随包默认 config 预置三能力 `enabled: true` |
| B-003 | 四层技能合并：来源序 项目 `.anycode/skills/*.md` > 全局 `~/.anycode/skills/*.md` > `.agents` `~/.agents/skills/*.md` > 内置（abilities kind:skill）；**同名后层覆盖 + warning** |
| B-004 | 目录注入：system prompt 只注入 `<available_skills>`（name + description）；**description 超 200 字符截断**；正文不注入 |
| B-005 | `skill` 工具：`skill(name)` 按需返回该技能全文 `<skill_content>`（目录中任意来源；内置或磁盘） |
| B-006 | 规则注入：**AGENTS.md 三层 additive**（全局 `~/.anycode/AGENTS.md` + 项目 `workspaceDir/AGENTS.md` + `.agents/AGENTS.md`），同目录 `AGENTS.override.md` 优先于 `AGENTS.md`；**`.anycode/rules/` 不再读取**（superseded，破坏性） |
| B-007 | MCP 合并：内置连接器（kind:mcp abilities 启用者）+ 全局 config.yaml `mcp` + 项目 `.anycode/mcp.yaml` 并集；**同名整条覆盖**（高优先层整条替换低层，非字段级 merge）；`enabled:false` 保留定义、运行时不建连 |
| B-008 | web-fetch 连接器（bundled stdio MCP）：工具 `fetch_url(url, maxChars?)` → HTTPS GET → 15s 超时/重定向/50KB 文本上限 → HTML→Markdown 返回 |
| B-009 | web-search 连接器（bundled stdio MCP）：工具 `search(query, maxResults?)`；`config.provider: ddg`（无 key 默认，best-effort）/ `tavily` / `bing`（配 `config.apiKey`） |
| B-010 | browser-use 内置 skill 注册（编排文档：web-search 找 → web-fetch 取 → 提取链接再取） |
| B-011 | `reloadConfig()` 热生效：abilities 开关/连接器 config 变更，下次 agent 创建（initMcp / getSystemMessage）起效 |
| B-012 | Settings"内置能力"面板：列出注册器全部能力（name+description+开关），**无删除入口** |

## Constraints

| id | description |
|---|---|
| C-001 | 内置能力不可删除：注册器无 unregister；UI 无删除入口（只可开关） |
| C-002 | web-fetch 仅接受 https（http/file 等拒绝）；超时/大小上限必须有（防挂死/防爆） |
| C-003 | 内置连接器随包自包含、离线可用，运行时不依赖 npx / 外网下载 |
| C-004 | 未配置 = 不启用：不得隐式开启任何未在 config.abilities 中的能力 |
| C-005 | `skill` 工具与既有 `read` 工具不冲突：只读技能正文，不改文件 |

## Invariants

| id | description |
|---|---|
| I-001 | 注册器内能力名全局唯一（dup throw） |
| I-002 | 能力集合 = 确定性函数(config.abilities ∪ 注册表 ∪ 磁盘层快照)；reload 不漂移 |
| I-003 | `.anycode/rules/` 永不再被读取（破坏性，无兼容） |
| I-004 | 任何技能正文绝不进 system prompt（只进目录；全文只经 skill 工具） |

## Acceptance Criteria（AC 即测试契约）

| id | given | when | then |
|---|---|---|---|
| AC-001 | 注册器已含 `web-search` | 再次 `registerAbility({name:"web-search"})` | throw（fail-fast） |
| AC-002 | 用户 config 无 `abilities` | agent 创建 | 三能力均不启用：skill 目录无内置、MCP 不连内置连接器 |
| AC-003 | 使用随包默认 config（预置 abilities 开） | agent 创建 | `<available_skills>` 含 browser-use；`loadMcpTools` 入参含 web-fetch/web-search server |
| AC-004 | 项目 `.anycode/skills/web-fetch.md` 存在且内置同名 | 合并 | 项目版覆盖内置（目录 description 取项目版）+ 输出 warning |
| AC-005 | 某技能 description 300 字 | 注入 | 目录中描述 ≤200 字（截断）；正文不在 prompt |
| AC-006 | 调 `skill("browser-use")` | — | 返回与注册/磁盘一致的全文；调不存在技能名 → 明确错误 |
| AC-007 | 全局/项目/override 三份 AGENTS.md 存在，且 `.anycode/rules/` 有旧文件 | agent 创建 | 三份全进 prompt（additive），override 版优先于同目录 AGENTS.md；rules/ 内容**不出现** |
| AC-008 | 项目 `.anycode/mcp.yaml` 与 config.yaml 同名 `foo`；foo 另有 `enabled:false` 的旧定义 | 合并 | 项目整条替换 config 同名；`enabled:false` 的 server 不建连 |
| AC-009 | `fetch_url("https://example.com")` | 调用 | 返回 HTML 转换后的文本；`fetch_url("http://x")` → 拒绝错误；超 50KB/15s → 截断/超时错误 |
| AC-010 | abilities 配 `web-search: {enabled:true, config:{provider:ddg}}` | 调 `search` | 返回结果数组（best-effort）；配 tavily+apiKey 后走 tavily |
| AC-011 | reloadConfig 把 `abilities.web-search.enabled` 改 false | 下次 run | 连接器不再建连、目录不再含其依赖；改回 true 恢复 |
| AC-012 | Settings 打开"内置能力" | — | 列出 3 能力 + 开关；无删除按钮；开关保存后下次对话生效（E2E） |
| AC-013 ⚠LLM 依赖 | 默认 config | 发"查一下 X 的最新信息" | 真 LLM run：模型调用 search/fetch 工具（证据：工具被调 + 结果回传）；**对照组**：`abilities.web-search: {enabled:false}` 后同样任务，工具不存在/不调用 |

## Open Questions（已全决，无需 Human）

- skill 工具名：`skill`（对齐生态）。absorption: inferred（对齐 Claude Code/opencode）。
- 目录 XML 格式：`<available_skills>` 块（对齐生态）。inferred。
- ddg 后端稳定性：best-effort（accepted，v1 现实代价，key 为升级路径）。confirmed。
- 截断长度：200 字符（Q-4 决策）。confirmed。

## Decisions（Human 已决，冻结）

| id | question | selected | reason |
|---|---|---|---|
| DEC-031-1 | 首批能力清单 | v1 三件全注册（web-fetch/web-search 真连接器 + browser-use skill） | 心智一致 + 开箱即用 + 架构验证（Q-1） |
| DEC-031-2 | 连接器形态 | bundled stdio MCP server | 生态兼容、复用现成传输（Q-2） |
| DEC-031-3 | AGENTS.override.md | 纳入（同目录优先） | hermes/pi 同款逃生口（Q-3） |
| DEC-031-4 | catalog 预算 | 仅 description 截断，quota 后置 | 第一版小且可测（Q-4） |
| DEC-031-5 | 破坏性 | rules/ 退役不兼容；兼容能力不可删只可开关（注册器） | 产品无用户（用户决议） |
| DEC-031-6 | 浏览器 v2 | 真 CDP 浏览器不打包（desktop 内嵌 offscreen / 用户 CDP / opt-in playwright） | hermes 同款；v1 不阻塞 |

## Impact

```yaml
impact:
  rr: RR-025
  affects: [domain/src/abilities.ts(新), domain/src/builtin.ts(新), domain/src/skill.ts(重写),
            domain/src/rule.ts(重写), domain/src/mcp.ts, domain/src/config.ts,
            domain/src/main.ts(getSystemMessage/initMcp), domain/src/prompt.ts,
            domain/src/tools/(+skill 工具), web/pages/Settings.tsx, config.example.yaml]
  risk: medium
  breaking: true   # rules/ 退役、loadSkills 签名/语义重写
  superseded: [skill.ts 旧两层全量注入, rule.ts 旧 .anycode/rules/ 加载]
  existing_specs: [SPEC-016(todo), SPEC-021(todo)]
```
