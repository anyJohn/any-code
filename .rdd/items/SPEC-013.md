---
id: SPEC-013
type: spec
parent: FE-013
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: skills/rules/MCP 两层（Global + Project）合并；web /settings 仅全局不变
---

# SPEC-013: skills/rules/MCP 两层 + 合并

## behaviors
- B-001: loadSkills 合并全局 `~/.anycode/skills/*.md` + 项目 `<workspace>/.anycode/skills/*.md`（同名项目覆盖全局，不同名并集）
- B-002: loadRule 合并全局 `~/.anycode/rules/*.md` + 项目 `<workspace>/.anycode/rules/*.md`（同名项目覆盖全局）
- B-003: loadMcpTools 合并全局 `config.mcpServers` + 项目 `<workspace>/.anycode/mcp.yaml`（flat servers map，同名项目覆盖全局）
- B-004: memory 已两层（无改）；web /settings 仅编辑全局 config（providers + mcp，无改）
- B-005: 项目级文件由用户手动在 `<workspace>/.anycode/` 加（无 web 编辑 UI）

## constraints
- C-001: MCP 项目级 = `<workspace>/.anycode/mcp.yaml`（flat servers map，非 mcp: 段）(DEC-045) — status: confirmed
- C-002: 同名合并：项目覆盖全局；不同名并集（DEC-046）— status: confirmed
- C-003: 全局层路径：`~/.anycode/skills/`、`~/.anycode/rules/`、`~/.anycode/mcp.yaml`（镜像项目级）— status: confirmed
- C-004: web /settings 不变（仅全局 config.yaml）— status: confirmed
- C-005: 项目级无 web 编辑 UI（用户手动加文件）— status: confirmed

## invariants
- I-001: 全局 + 项目都加载（任一层缺失不影响另一层）— status: confirmed
- I-002: 同名时项目优先（更具体者赢，与 memory 两层一致）— status: confirmed
- I-003: 全局层缺失 → 退化为仅项目（向后兼容现有项目级）— status: confirmed

## acceptance_criteria（即测试契约）
- AC-001 (skills 两层): given 全局 ~/.anycode/skills/a.md + 项目 .anycode/skills/b.md, when loadSkills, then 返回含两者；同名 a.md（全局+项目）→ 项目内容胜出
- AC-002 (rules 两层): given 全局 + 项目 rules, when loadRule, then 合并（同名项目覆盖）
- AC-003 (MCP 两层): given 全局 config.mcpServers 含 s1 + 项目 mcp.yaml 含 s2 与 s1（覆盖）, when loadMcpTools, then 连 s1(项目版)+s2
- AC-004 (无全局层): given 仅项目 skills/rules/mcp, when 加载, then 仅项目（向后兼容）
- AC-005 (web /settings 不变): given /settings 保存, when POST /api/config, then 只写全局 config.yaml（不碰项目）

## open_questions（非 blocking，deferred 下轮）
- Q-013a status 面板 skill 数是否反映合并（全局+项目）— deferred，先仅项目
- Q-013b mcp.yaml 热更新（项目 mcp 改了重连）— deferred

## decisions (frozen)
- DEC-045: MCP 项目级 = <workspace>/.anycode/mcp.yaml（flat servers map）
- DEC-046: 同名合并项目覆盖全局；不同名并集（与 memory 两层一致）

## assumptions
- A-001: loadProjectMcp(workspace) 读 <workspace>/.anycode/mcp.yaml（js-yaml，flat map）；AnyAgent.initMcp 合并全局+项目后 loadMcpTools — status: inferred
- A-002: 测试——临时 HOME（全局层）+ 临时 workspace（项目层），验合并 + 同名覆盖 — status: inferred

## future (deferred)
- status 面板 skill 数反映合并（Q-013a）
- 项目 mcp 热更新（Q-013b）
- web 项目级文件浏览/编辑 → 非本 SPEC（用户手动）
