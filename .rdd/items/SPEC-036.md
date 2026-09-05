---
id: SPEC-036
type: spec
story: FR-21
parent: FR-21
status: implementing（批 1、2 已完成 2026-09-05）
owner: human
created: 2026-09-05
persists: permanent
origin: 用户决策 2026-09-05（会话内指令）+ 实测页面（playwright 390px/1280px）+ 用户提供 RelayAgent 文件实现参考
---

# SPEC: FR-21 Web 体验补全（三批实施）

> 交互模型参考用户提供的 RelayAgent 实现：ChatView 上方 tab（聊天 | 变更 | 文件）、
> 文件预览 + 行号划选引用、输入框上方引用横条。分三批，子项独立验收。

## 批次

- **批 1（纯前端）**：⑥ 窄屏响应式 + ① 复制/高亮 + ⑤ 渲染性能
- **批 2（server+web）**：② 变更 tab（快照 diff）+ ④ 文件 tab（列表/预览/引用横条）+ todo 面板
- **批 3（跨层）**：③ 编辑用户消息重发（domain 会话截断 + server 路由 + web）
- 子项 ⑦ 超长输入卸载：延后（用户决策 2026-09-05）

## 决策（人类，2026-09-05 会话）

- DEC-124：**Tab 交互模型**——ChatView 上方三 tab（聊天/变更/文件），不做终端/shell/日志/报告/hooks 等扩展 tab；"文档"并入文件 tab 搜索。
- DEC-125：**文件引用横条**——@ 补全选中后进引用横条（不再往输入框插文本）；preview 划选起止行生成 `path:10-20` 引用；发送时统一拼 `\n\nFiles: path1, path2`。
- DEC-126：**高亮库 rehype-highlight**（轻量、react-markdown 管线内）；响应式断点 md=768px，CSS 断点驱动，<md 侧栏覆盖式抽屉 + 顶栏最左开关按钮（md:hidden），不做边缘滑动手势。

```yaml
spec:
  behaviors:
    # 批 1
    - { id: B-001, description: "代码块（MarkdownRenderer）带语言标签 + 复制按钮 + 横向滚动；rehype-highlight 高亮（跟随明暗主题）" }
    - { id: B-002, description: "assistant 消息整条复制按钮（hover 显示）" }
    - { id: B-003, description: "<768px：侧栏 fixed 覆盖抽屉（默认移出屏外），顶栏最左开关按钮 md:hidden，backdrop 点击关，路由跳转后自动收；≥768px 桌面行为（拖宽/折叠 rail）完全不变" }
    - { id: B-004, description: "代码块 pre overflow-x-auto；窄屏状态栏隐藏次要项（skill/mcp 计数）" }
    - { id: B-005, description: "renderItems 增量化（保留上次结果只 append 新事件）+ TurnBlock/ToolRow React.memo；长会话不随新事件全量重算" }
    # 批 2
    - { id: B-006, description: "ChatView 三 tab：聊天（默认）/ 变更 / 文件；窄屏下 tab 同样可用" }
    - { id: B-007, description: "变更 tab：GET /api/workspaces/:key/snapshots/:id/diff 返回本轮文件变更（status + patch）；文件列表点开单文件 diff（统一视图）" }
    - { id: B-008, description: "文件 tab：全量文件列表（GET /files?all=1，rg --files）+ 搜索过滤 + gitignore 可见性开关（--no-ignore --hidden 重拉）+ 前端平铺建树" }
    - { id: B-009, description: "GET /api/workspaces/:key/file?path=：resolvePath 限制在 workspace 根内；utf-8 decode error=replace；>1MB 返回 400 WorkspaceFileTooLargeError（前端弹提示）；二进制（首块 null byte）拒显" }
    - { id: B-010, description: "preview modal：行号 + 高亮 + 点选起止行生成 path:10-20 引用；不划选=整文件引用" }
    - { id: B-011, description: "输入框上方引用横条：tag（path:行号 + 叉号）；@ 补全选中进横条；发送时 prompt 统一拼 \\n\\nFiles: path1, path2（行号形式 path:10-20）" }
    - { id: B-012, description: "聊天 tab 内 todo 面板：渲染本轮 Planning 事件（per-run 生命周期，不持久化）" }
    # 批 3
    - { id: B-013, description: "用户消息 hover 出编辑 → 修改后截断会话到该消息前并重发（domain sessionService 截断 API + server 路由 + AR-4 快照回滚文件状态）" }
  constraints:
    - { id: C-001, description: "≥768px 桌面交互零回归（侧栏拖宽/折叠 rail 照旧）" }
    - { id: C-002, description: "文件路由是只读浏览——不做编辑/删除/重命名；文件 watch 不做" }
    - { id: C-003, description: "不引入虚拟滚动；不引入窗口宽度 JS 监听（CSS 断点 + state 开关）" }
    - { id: C-004, description: "domain 记忆/会话日志不变式（AR-23）在截断路径上依然成立" }
  acceptance_criteria:
    - { id: AC-001, given: "390px 视口", when: "浏览/发消息/开抽屉", then: "聊天区全宽可用、代码块横滑、抽屉开合正常（playwright 实测截图）" }
    - { id: AC-002, given: "含代码块的回复", when: "渲染", then: "高亮 + 语言标签 + 一键复制（剪贴板内容一致）" }
    - { id: AC-003, given: "长会话追加事件", when: "渲染", then: "既有渲染项不重算（memo 生效，React DevTools/性能实测）" }
    - { id: AC-004, given: "一轮含 edit/write 的任务", when: "打开变更 tab", then: "文件变更列表与单文件 diff 正确展示" }
    - { id: AC-005, given: "文件 tab", when: "搜索/开 ignore 开关/点文件划选行引用", then: "列表过滤、隐藏文件显隐、引用横条 tag 与 Files: 拼接正确" }
    - { id: AC-006, given: ">1MB 或二进制文件", when: "preview", then: "400 错误提示 / 二进制拒显占位" }
    - { id: AC-007, given: "历史会话", when: "编辑某条用户消息重发", then: "该消息之后的对话被截断、文件状态回滚、新回复基于编辑后消息" }
```

## 实现落点

- 批 1（web）：`AppShell/AppTopbar/AppSidebar`（抽屉）、`MarkdownRenderer`（rehype-highlight + 复制）、`MessageList/TurnBlock/ToolRow/renderItems`（memo + 增量）、`StatusBar/InputBox`（响应式 class）
- 批 2：server `index.ts`（snapshot diff 路由、file 路由、files?all=1）；web `ChatView` tab、`ChangesTab`、`FilesTab/Tree/PreviewModal`、`InputBox` 引用横条 + Files: 拼接、todo 面板
- 批 3：domain `sessionService`（截断）、server 路由、web 消息编辑交互
