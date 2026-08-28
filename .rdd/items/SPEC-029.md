---
id: SPEC-029
type: spec
parent: FE-020
status: approved
created: 2026-08-28
approved: 2026-08-28
persists: permanent
scope: FE-020 Electron 桌面客户端（Win exe + Linux AppImage）
---

# SPEC-029: Electron 桌面客户端

> 跨特性决策见 DEC-007（静态 SPA + hono sidecar 范式）+ DEC-008（loadURL refine loadFile）。场景 A（新特性，在 Vite+hono 基础上加 Electron 层）。

## behaviors
- B-001: 双击桌面 app → Electron main 嵌入起 hono server（`import @any-code/server`，绑 `127.0.0.1:<freePort>`）→ `BrowserWindow.loadURL('http://127.0.0.1:<port>')` 显示 SPA。
- B-002: 关窗 = stop server（端口释放，不后台跑）。
- B-003: 自包含——app resources 捆绑 `web/dist` + server bundle + rg（linux+win）+（win）busybox；Electron 自带 node 跑 server，不依赖 prior install。
- B-004: electron-builder 出 Windows（NSIS exe）+ Linux（AppImage）安装包。
- B-005: macOS 不做（本 RR 排除）。

## constraints
- C-001: server 嵌入 Electron main（`import @any-code/server`），不 spawn 独立子进程。— confirmed
- C-002: UI 用 loadURL（同源），不 loadFile（CORS），见 DEC-008。— confirmed
- C-003: 新增分发，不动 install.sh/ps1（web/CLI 保留）。— confirmed
- C-004: 仅监听 127.0.0.1（安全，同 web）。— confirmed
- C-005: 自包含，不依赖 `~/.anycode` prior install。— confirmed

## invariants
- I-001: 桌面 app 行为与 `anycode web` 一致（复用同一 server + dist，仅窗口替浏览器）。— confirmed
- I-002: 关窗 = server 停（无后台残留）。— confirmed
- I-003: Win exe 与 Linux AppImage 都能双击启动到可用 UI+API。— confirmed

## acceptance_criteria
- AC-001: 双击 exe/AppImage → 窗口开、loadURL 成功、`/api/config` 200、SPA 渲染。
- AC-002: 桌面窗口内 agent 跑任务（`POST /run` SSE）正常，事件流渲染（复用 useAgent）。
- AC-003: 关窗 → server 停（端口释放）。
- AC-004: electron-builder 产出 Windows NSIS `.exe`（dist/ 存在）。
- AC-005: electron-builder 产出 Linux AppImage（可执行，`./xxx.AppImage` 跑起）。
- AC-006: 干净机器（无 `~/.anycode` prior install）双击即用（自包含验证）。
- AC-007: 桌面 app 内 agent 调 grep/glob（rg）+ bash（win busybox）正常。

## decisions（feature-scoped, frozen）
- Q-021 → sidecar 形态：嵌入 Electron 主进程（`import @any-code/server`）。
- Q-022 → UI 加载：loadURL 同源（DEC-008 refine DEC-007 loadFile）。
- Q-023 → 与 install 关系：新增分发（install.sh/ps1 保留）。
- Q-024 → 捆绑运行时：自包含（Electron node + dist + server + rg + busybox 全打进）。

## assumptions（待确认 / inferred）
- A-001: 新建 `desktop/` 包，deps: electron + electron-builder + @any-code/server(workspace) + @any-code/domain。— inferred
- A-002: desktop build 前先 `vite build`(web) + `esbuild`(server) 产出 dist+server.mjs，bundle 进 app resources。— inferred
- A-003: **Windows exe 构建**：electron-builder 可从 Linux 交叉编译 Win NSIS（下 Win electron + wine），但 flaky；**生产 Win exe 可能需 CI/Windows**。本机（Linux）能产 Linux AppImage 验证 + 配 Win target。— inferred（需实测）
- A-004: 捆绑 rg（@vscode/ripgrep linux+win 平台二进制）+ busybox（win）进 resources；launcher 的 `ANYCODE_RG_PATH` 注入逻辑复用。— inferred
- A-005: 代码签名（Win SmartScreen 信誉 / Linux 无）暂不做（后续；本 RR 不含签名）。— inferred
