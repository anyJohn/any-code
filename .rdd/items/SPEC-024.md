---
id: SPEC-024
type: spec
parent: RR-018
status: approved
created: 2026-08-25
approved: 2026-08-25
persists: permanent
scope: 端到端安装（Win+Linux 安装脚本 + anycode --web 启动器 + Windows agent bash）
---

# SPEC-024: 端到端安装（Win+Linux）

## behaviors
- B-001: 一行安装命令——Linux `curl -fsSL <raw>/build/install.sh | bash`；Windows `powershell -NoProfile -ExecutionPolicy Bypass -c "iwr -useb <raw>/build/install.ps1 | iex"`。install.bat 为 cmd/双击入口（薄 shim→ps1）。
- B-002: 安装器下载仓库 zip（`github.com/<org>/any-code>/archive/refs/heads/main.zip`，codeload，不依赖系统 git）解压到 `~/.anycode/app`。
- B-003: 安装器私有 provision node：探测 arch → 下载 nodejs.org 平台包（linux tar.xz / win zip）到 `~/.anycode/runtime/node` → `corepack enable` + 激活 pnpm。不写系统 PATH、不要 sudo。
- B-004: 安装器在 `~/.anycode/app` 跑 `pnpm install --frozen-lockfile` + `pnpm --filter @any-code/web build`（next build → `web/.next`）。
- B-005: 安装器注册 `anycode` 到 PATH：Linux 写 `~/.anycode/bin/anycode` shim（→ `build/launcher.sh`）+ patch `.bashrc/.zshrc` 加 `~/.anycode/bin`；Windows 写 `anycode.bat` + `setx PATH`（User 作用域）。
- B-006: `anycode --web` 启动器：私有 node 加 PATH → `cd ~/.anycode/app/web` → `next start -H 127.0.0.1 -p <port>`（3000 默认，占用自增到空闲）→ 等端口就绪开浏览器（linux `xdg-open` / win `start`）→ 前台 wait（Ctrl+C 杀服务）。
- B-007: bash.ts 改显式 `spawn(binary, ["-c", cmd], {cwd, signal, windowsHide})`：unix binary=`/bin/sh`；win binary=PortableGit `bash.exe`（`ANYCODE_GIT_BASH_PATH` → 系统 Git `C:\Program Files\Git\bin\bash.exe` 回退 → 抛错）。cwd 经 `toMsysCwd` 翻译（`C:\Users\foo`→`/c/Users/foo`）。
- B-008: Windows 安装器额外下 PortableGit（**非 MinGit**，需 bash.exe+coreutils）自解压到 `~/.anycode/runtime/portablegit` + `setx ANYCODE_GIT_BASH_PATH`（User）。
- B-009: ripgrep Windows 二进制：`domain/package.json` 加 `@vscode/ripgrep-win32-x64` optionalDep（现仅 linux-x64）。
- B-010: 根 `package.json` 加 `"packageManager": "pnpm@<ver>"`（corepack 锁 pnpm，安装器靠它不另下 pnpm）。
- B-011: 下载校验——node/PortableGit zip 下载后 sha256 校验（非技术用户防篡改/截断）。

## constraints
- C-001: 不假设用户机器有 node/npm/pnpm/git — confirmed
- C-002: 不写系统 PATH、不要 sudo/admin；PATH 仅加 `~/.anycode/bin` 到用户 shell rc / User PATH — confirmed
- C-003: web 仅监听 127.0.0.1（沿用现有 `next start -H 127.0.0.1`），不暴露公网 — confirmed
- C-004: 本特性只 Win+Linux；macOS/Electron 客户端/代码签名后续 — confirmed
- C-005: 本地构建模式，不引入 `output:"standalone"`（node_modules 已在，规避 ripgrep tracing 坑） — confirmed
- C-006: Windows bash 与 unix 一致（bash，非 pwsh），prompt/skills 不分叉 — confirmed

## invariants
- I-001: 卸载 = `rm -rf ~/.anycode`（单命名空间，含配置 + 运行时 + app + bin）

## acceptance_criteria
- AC-001（前置）: web prod 模式端到端可用——`pnpm install && pnpm --filter @any-code/web build && pnpm --filter @any-code/web start` → 浏览器开 → 跑真实 agent 任务（含 bash/read 工具 + SSE 流）全程正常。**此前只验过 next dev，此 AC 不通则整个安装流断，须先修。**
- AC-002: Linux 一行安装命令在干净机器（临时 HOME，无 node）跑通 → `anycode --web` 起来 + 浏览器开 + agent bash 能跑 `ls`/`grep`。
- AC-003: Windows 一行安装命令跑通 → `anycode --web` 起来 + agent bash 能跑 `ls`/`grep`/管道（PortableGit + MSYS cwd 翻译）。
- AC-004: bash.ts 显式 `spawn(binary,["-c",cmd])`；unix binary=`/bin/sh`；win binary=bash.exe（env→系统 Git 回退→抛错）；`toMsysCwd` 单测覆盖 `C:\Users\foo`→`/c/Users/foo`、`/bin/sh` 路径不动。
- AC-005: 安装器不写系统 PATH、不要 sudo——私有 node 在 `~/.anycode/runtime`，PATH 仅加 `~/.anycode/bin`（用户级）。
- AC-006: 下载校验——node/PortableGit 包 sha256 不符即报错终止。
- AC-007: 根 package.json 有 `packageManager`；domain/package.json 有 `@vscode/ripgrep-win32-x64` optionalDep。

## decisions (frozen)
- DEC-084: 私有 provision node（nodejs.org tarball + pnpm standalone），不碰系统。理由：满足"非技术用户无 node"硬约束；业界主流 harness 的私有 node 目录同模式。
- DEC-085: 下载仓库 zip（codeload）而非 git clone。理由：不依赖用户装 git。
- DEC-086: 运行用 next start 而非 standalone。理由：本地构建 node_modules 已在，最简；standalone 的 ripgrep 二进制 tracing 坑规避。
- DEC-087: 单命名空间 `~/.anycode`（config + runtime + app + bin）；卸载=`rm -rf ~/.anycode`。理由：非技术用户简单可理解 + 匹配业界主流 harness 的单目录惯例。
- DEC-088: Windows bash 走 PortableGit（非 MinGit 无 bash.exe+coreutils；非 pwsh 避免 prompt/skills 分叉）。保持 bash 全平台统一。
- DEC-089: bash.ts 改显式 `spawn(binary,["-c",cmd])`。理由：Node `shell:<bash.exe>` 在 Windows 传 `/d /s /c`（cmd 语法）bash 不认；显式 `-c` 规避（业界主流 harness 同模式）。
- DEC-090: 本特性只 Win+Linux；macOS、Electron 客户端、代码签名（SmartScreen/Gatekeeper）作为后续。
- DEC-091: 端口默认 3000，占用则自增到空闲。
- DEC-092: pnpm 用 standalone 二进制（`pnpm/pnpm` releases 的 `pnpm-linux-x64.tar.gz`/`pnpm-win32-x64.zip`），不用 corepack。原因：node v22.11.0 自带 corepack 0.29 验签坏（npm registry 签名 key 轮换，旧 known-keys 不匹配 → `Cannot find matching keyid`，`COREPACK_INTEGRITY_KEYS=none` 也无效），会阻断所有用户安装。pnpm standalone 自带 node、无验签、解压即用。
- DEC-093: Windows Git Bash 路径走 `~/.anycode/config.yaml` 顶层 `gitBashPath`（非 env var）。原因：env var（setx 写注册表）脆弱、不可经 /settings 编辑；config 是单一可信源。bash.ts 候选序：config.gitBashPath → 安装器下发位置 `~/.anycode/runtime/portablegit/bin/bash.exe` → 系统 Git。install.ps1 在 config.yaml 已存在时合并写入 `gitBashPath`；首装无 config 时 bash.ts 自动发现下发位置。
- DEC-094: 运行用 Next.js `output:"standalone"`（**反转 DEC-086**）。原因：DEC-086 的 `next start` 需全量 node_modules（~700MB）在旁，app 体积 ~830MB 太大；standalone 自包含 bundle（~62MB），运行只需 `.next/standalone`。体积从 ~1.2GB（Linux）/ 1.39GB（Win）降到 **~260MB**。配套：①ripgrep 二进制 vendor 到 `~/.anycode/runtime/rg/rg`（standalone 不含 @vscode/ripgrep 平台二进制），domain `ripgrep.ts` 读 `ANYCODE_RG_PATH`（launcher 注入），@vscode/ripgrep 降级为 dev 动态 import fallback；②build 后拷 `.next/static`+`public` 进 standalone，删 `.next` 非 standalone 的 build traces；③删 build-only `node_modules` + pnpm（standalone 自包含，safe_rm 锚定守卫）；④launcher 改跑 `node .next/standalone/web/server.js` + 设 `PORT`/`HOSTNAME=127.0.0.1`（standalone server.js 默认 0.0.0.0 公网，必须改）。未来 Electron 客户端也复用此 standalone bundle。

## 实现顺序
1. AC-001 前置验证（prod build+start 端到端）——不通先修 web。
2. bash.ts 重构 + 单测（AC-004）+ package.json 小改（AC-007）。
3. build/ 脚本与启动器（US-A..F）。
4. Windows PortableGit 下发 + setx（US-G/H）。
5. AC-002/003 真 install 验证（Linux 临时 HOME / Windows）。

## 实现记录（2026-08-25）
- AC-001 ✓：web prod 模式（next build + next start）端到端可用——真实 SSE run（Thinking→ToolStart→ToolProgress→Tool→Assistant→Done，bash 工具执行 echo）。此前只验过 next dev。
- AC-004 ✓：bash.ts `spawn(cmd,{shell:true})` → 显式 `spawn(binary,["-c",cmd])`；`resolveShell(cwd, gitBashPath?)` + `toMsysCwd`；单测 8 用例（含 config 优先 / PortableGit 下发位置 / 系统 Git 回退 / 抛错）。
- AC-007 ✓：根 package.json `packageManager: pnpm@11.8.0`（注：后改用 pnpm standalone，此字段不再 load-bearing 但保留）；domain/package.json 加 `@vscode/ripgrep-win32-x64`。
- build/ ✓：install.sh（Linux）+ install.ps1（Windows）+ install.bat + launcher.sh/launcher.bat + versions.env + README.md。私有 provision node v22.11.0 + pnpm 11.8.0 standalone（DEC-092，绕开 corepack 坏）；codeload tarball/zip 拉仓库（不依赖 git）；sha256 校验 node；注册 `anycode` 到用户 PATH。
- AC-002 ✓：Linux 临时 HOME 真 install 跑通（node+pnpm standalone+pnpm install+next build+注册），`anycode --web` 启动 → `/` 200 + `/api/workspaces` 200。注：首次跑因网络抖动下载 next/swc 超时失败（非 install.sh bug），复用已建 pnpm store 后通过。
- AC-003 ⏳：Windows 真 install 需 Windows 机器验证（本机 Linux 无法跑 install.ps1）。脚本逻辑镜像 Linux + PortableGit 自解压 + config.yaml 合并 gitBashPath，待 Windows/CI 验。
- 重构后回归 ✓：AC-001 重验（refactored domain + config gitBashPath）prod bash 任务通过；domain tsc 0 + 92/92。
- standalone（DEC-094，反转 DEC-086）✓：next.config `output:"standalone"`；ripgrep vendor 到 `runtime/rg/rg` + ripgrep.ts 读 `ANYCODE_RG_PATH`（@vscode/ripgrep ESM 动态 import fallback，standalone 下缺失不致命）；build 后拷 static/public 进 standalone、删 .next build traces、删 build-only node_modules + pnpm（safe_rm 锚定）；launcher 改跑 `node .next/standalone/web/server.js` + HOSTNAME=127.0.0.1。体积 ~1.2GB→**260MB**。Linux 验：anycode --web Ready 310ms / 200 + /files（ripgrep --files）返 20 文件（vendored rg 跑通）。domain 92/92 含 ripgrep.test。
- deferred：Electron 桌面客户端（复用 standalone bundle）、macOS、代码签名、`anycode update`、node 的 npm/corepack trim（运行时只用 node 二进制，省 ~85MB）。
