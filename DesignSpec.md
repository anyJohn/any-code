# DesignSpec — UI 设计规范

> 界面统一遵循本规范；新增界面先读此文件。规范与代码冲突时，以规范为准修代码。
> 生成端审美遵循 `web-design-guidelines` 技能（Vercel，排版/留白/颜色/反 AI 味）。

## 主题与配色（暗黑模式定稿）

三态：浅色 / 深色 / 跟随系统（`config.yaml ui.theme`；跟随系统 = 桌面 nativeTheme、浏览器 prefers-color-scheme）。实现在 `web/theme.tsx`（ThemeProvider）+ `web/globals.css`（`.dark` 类策略）。

**色彩来源（定稿小样，`docs/theme-samples/`）：暗色 = 小样 B（Monokai Pro），亮色 = 小样 E（其亮色姊妹版）。** 两版共用品牌靛蓝主色与 Monokai 色相点缀，亮暗切换观感连续。

### 亮色 token（小样 E）

| token | 值 | 用途 |
| --- | --- | --- |
| background | `#F6F5F2` | 页面底（暖白） |
| card / popover | `#FFFFFF` | 卡片、浮层 |
| sidebar / muted / secondary / accent | `#ECEAE4` | 侧栏、次级面、hover |
| foreground | `#2C2A2E` | 正文 |
| muted-foreground | `#8A858C` | 次要文字 |
| border / input | `#E0DDD6` | 描边、输入框 |
| destructive | `#E11D6E` | 危险/报错 |
| primary | 品牌靛蓝 `#6178FD`（`--brand`） | 主操作，亮暗一致 |

### 暗色 token（小样 B）

| token | 值 | 用途 |
| --- | --- | --- |
| background | `#221F22` | 页面底（暖紫灰，禁用纯黑） |
| sidebar | `#1B191B` | 侧栏（比主底更深一档） |
| card / popover | `#2D2A2E` | 卡片、气泡、浮层 |
| secondary / muted | `#363338` | 次级面 |
| accent | `#3A363C` | hover 态 |
| foreground | `#FCFCFA` | 正文 |
| muted-foreground | `#939293` | 次要文字 |
| border / input | `#423F42` | 描边、输入框（实色，不用半透明白） |
| destructive | `#FF6188`（Monokai 粉） | 危险/报错 |
| primary | 品牌靛蓝 `#6178FD` | 主操作 |

状态色（两主题同相，组件按需取用）：成功 `#A9DC76` / 进行中 `#FFD866`（暗）`#B08514`（亮）/ 危险 `#FF6188`（暗）`#E11D6E`（亮）。chart-1..5 = 绿/黄/紫/橙/粉。

### 规则

1. **组件颜色一律走主题 token**（`bg-background` / `text-muted-foreground` / `border-border` …），禁止硬编码 `zinc-*` / `gray-*` / `bg-white` / `text-black`；例外仅限：遮罩层（`bg-black/50`）、hover 上的纯白图标。
2. **代码块跟随主题**：亮色 GitHub Light 风格（`--codeblock-*` 变量，`#F6F8FA` 底），暗色深底（`#1B191B`，比卡片更深一档）；语法高亮亮色走 github.css、暗色走 `.dark .hljs` 覆盖——**不要给代码加恒暗类**。
3. **层级靠亮度差**：暗色下 页面 < 卡片 < hover 三档（`#221F22 → #2D2A2E → #3A363C`），亮色下同理；不要用阴影堆层级。
4. 新增 UI 若需新颜色，先扩 token 再使用，不在组件里写魔法值。

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
