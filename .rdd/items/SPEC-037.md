---
id: SPEC-037
type: spec
story: FR-31
parent: FR-31
status: completed
owner: human
created: 2026-09-07
persists: permanent
origin: 用户 todo（2026-09-06）："权限做成 per session 的，全局配置改成默认模式，session 对话框里做下拉切换"
---

# SPEC: per-session 权限模式

> 场景 A（增量）：AR-3（SPEC-032）之上加会话维度。全局 `permissions.mode` 语义从
> "预设模式"变为"**默认模式**"——新会话继承；会话可单独切换并持久化。

## 决策（人类，2026-09-07 会话授权直接实施）

- DEC-130：**会话模式持久化到 session meta**（跟会话走、重启保持；内存态方案重启丢失被否）。
- DEC-131：**UI 放聊天 tab 行右侧下拉**（默认（跟随全局）/标准/编辑信任/完全信任）；切换当条消息生效（per-request agent 语义，与 config 热更一致）。
- DEC-132：**项目级/全局规则与危险基线不受会话模式影响**——只有 mode 可被会话覆盖。

```yaml
spec:
  behaviors:
    - { id: B-001, description: "session meta 新增 permissionMode（末条为准）；entriesToSession/metaOf/SessionMeta 提取" }
    - { id: B-002, description: "buildPermissionContext 的 mode = 会话 permissionMode ?? 全局 cfg.mode；rules/dangerPatterns 不受影响" }
    - { id: B-003, description: "POST /api/sessions/:id/permission-mode {mode} → 持久化；GET 同路径读当前（会话无 → 全局默认）" }
    - { id: B-004, description: "聊天 tab 行右侧下拉显示/切换当前会话权限模式；切换即时持久化并本地更新（下条消息生效）" }
  constraints:
    - { id: C-001, description: "无 permissionMode 的历史会话行为不变（回退全局默认）" }
    - { id: C-002, description: "新会话（无 sessionId）不显示下拉（首条消息建会话后再出现）" }
  acceptance_criteria:
    - { id: AC-001, given: "会话切到 trusted", when: "新消息执行写类工具", then: "不弹 ask（全局 standard 下同会话 trusted 生效）" }
    - { id: AC-002, given: "重启 server 后 resume 该会话", when: "读模式", then: "仍为 trusted（meta 持久化）" }
    - { id: AC-003, given: "未设置过的历史会话", when: "读模式", then: "返回全局默认，行为与旧版一致" }
```

## 实现落点

- domain：session.ts（meta 类型/提取/entry helper）、sessionService（setPermissionMode）、main.ts（buildPermissionContext 覆盖）
- server：POST/GET /api/sessions/:id/permission-mode
- web：ChatView 模式下拉 + i18n
