# DesignSpec — UI 设计规范

> 界面统一遵循本规范；新增界面先读此文件。规范与代码冲突时，以规范为准修代码。

## 折叠/展开（Accordion）

可折叠区块（文件 diff、目录树、面板分组等）统一交互：

- **箭头位于标题（行首）左侧**；
- **收起态箭头朝右**（`ChevronRight`），**展开态箭头朝下**（`ChevronDown`）；
- 点击整行标题切换展开态，展开内容缩进于标题行下方。

## 弹窗（Modal）

所有弹窗（Dialog/Modal）统一三区结构：**header、body、footer**。

```text
┌────────────────────────────────────┐
│ 标题                     [✕]       │  header
│ 副标题（可选）                      │
├────────────────────────────────────┤
│ 弹窗主体内容                        │  body
│ …                                  │
├────────────────────────────────────┤
│ [关闭]              [次要操作][主操作] │  footer
└────────────────────────────────────┘
```

### header

- 承载：**标题**、**副标题**（可选）、**close 图标**（✕，右上角）。
- 标题一行，字号 `text-lg font-semibold`；副标题 `text-sm text-muted-foreground`。
- close 图标点击必须能关闭弹窗。

### body

- 承载弹窗主体内容；内容超高时 body 区域内滚动（`max-h-[60vh] overflow-y-auto`），弹窗整体不超高。

### footer

- 承载操作按钮，**右对齐**为主操作区。
- **至少有一个 close 按钮能关闭弹窗**：
  - close 按钮**固定在左侧**，普通按钮配色（`outline` / ghost），**不得用 primary 配色**；
  - 具体的弹窗操作（如"确定/提交/允许"）在**右侧**，primary 按钮；多个操作时次要操作在主操作左边。
- 语义说明：当弹窗是"裁决/确认"类（必须做出选择才能继续），左侧 close 按钮即"否定路径"（如权限弹窗的"拒绝"）——关闭即选择否定，不允许静默关闭。

### 组件落点

- 基础组件：`web/components/ui/dialog.tsx`（shadcn Dialog）+ `ModalFooter`（关闭左 / 操作右的规范布局）。
- 各弹窗一律用 `ModalFooter`，不手写 footer 布局。

### 现有弹窗对照

| 弹窗 | 左侧（close） | 右侧操作 |
| --- | --- | --- |
| InteractionModal | 停止任务（= 关闭并中止本轮 ask） | 提交（primary） |
| PermissionModal | 拒绝（= 关闭并裁决为拒绝） | 允许一次 / 永久允许（primary） |
| SnapshotsDialog | 关闭 | （回滚在每行内，不入 footer） |
| DirectoryPicker | 取消 | 选择目录（primary） |
| FilePreviewModal | 关闭 | 添加引用（primary） |
