# anycode 安装

面向非技术用户的端到端安装：一行命令拉取仓库、私有化安装 node、构建 web、注册 `anycode` 命令。用户机器只需 `curl`（Linux）/ PowerShell（Windows，系统自带），**不需要预装 node / npm / pnpm / git**。

## 一行安装

**Linux**（bash / zsh / fish）：

```bash
curl -fsSL https://raw.githubusercontent.com/anyJohn/any-code/main/build/install.sh | bash
```

**Windows**（PowerShell）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -c "iwr -useb https://raw.githubusercontent.com/anyJohn/any-code/main/build/install.ps1 | iex"
```

Windows 也可下载 `build/install.bat` 双击（薄 shim，内部跑 install.ps1）。

装完打开**新终端**，运行：

```
anycode web
```

浏览器自动打开 `http://127.0.0.1:3000`，即 web 端 agent。`Ctrl+C` 停止服务。

其他命令：

| 命令 | 作用 |
|---|---|
| `anycode web [--port=N]` | 启动 web 端 |
| `anycode update` | 重新拉取 + 重建到最新版（复用安装器，幂等） |
| `anycode uninstall [-y]` | 卸载（删 `~/.anycode`；默认二次确认） |
| `anycode help` / `anycode --help` | 打印用法 |

## 中国用户 / 镜像

国内网络下 GitHub 与 npm 常被限速，安装可能"卡住"（下载静默挂死）。安装器内置镜像与下载硬化（超时 + 重试 + 进度）：

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `ANYCODE_MIRROR` | `auto`（按本机时区自动判中国）/ `cn`（强制镜像）/ `none`（强制直连） | `auto` |
| `ANYCODE_NPM_REGISTRY` | `pnpm install` 走的 registry | 自动：cn→`registry.npmmirror.com` |
| `ANYCODE_NODE_BASE` | node 下载源 | 自动：cn→`cdn.npmmirror.com/binaries/node` |
| `ANYCODE_GH_PROXY` | GitHub 下载（pnpm standalone / 仓库 tarball / `anycode update` 拉脚本）前拼的代理 | 空（直连） |
| `REPO_TARBALL_URL` | 仓库 tarball 完整 URL（fork / mirror / 离线快照） | GitHub codeload |

镜像开启时：node 从 `cdn.npmmirror.com` 下、`pnpm install` 走 `registry.npmmirror.com`（含 ripgrep 平台子包，一并走镜像）。pnpm standalone 与仓库 tarball 仍在 GitHub，靠下载超时 + 重试兜底；若仍卡，设 `ANYCODE_GH_PROXY=https://ghproxy.com/`（公共代理不稳，自行选可用者）。

强制走镜像（一行安装）：

```bash
export ANYCODE_MIRROR=cn
curl -fsSL https://raw.githubusercontent.com/anyJohn/any-code/main/build/install.sh | bash
```

> `curl | bash` 管道下，`bash` 继承的是当前 shell 已 `export` 的环境变量；故需先 `export ANYCODE_MIRROR=cn` 再跑一行安装（`ANYCODE_MIRROR=cn curl ... | bash` 这样写只对 `curl` 生效，对 `bash` 无效）。

## 安装器做了什么

1. **私有 provision node**：下载 nodejs.org LTS 到 `~/.anycode/runtime/node`。下载 pnpm standalone（`pnpm/pnpm` releases）到 `~/.anycode/runtime/pnpm`（绕开 corepack 0.29 验签 bug）。不写系统 PATH、不要 sudo / admin。
2. **拉取仓库**：从 GitHub 下载 tarball / zip（codeload，不依赖系统 git）解压到 `~/.anycode/app`。
3. **构建**：`pnpm install --frozen-lockfile` + `pnpm --filter @any-code/web build`（vite build）+ `pnpm --filter @any-code/server build`（esbuild → server.mjs）；随后删除 build-only node_modules 省空间。
4. **注册命令**：复制启动器到 `~/.anycode/bin/anycode` 并把该目录加到用户 PATH（Linux patch shell rc；Windows User PATH）。
5. **Windows 额外**：下载 busybox-w32（sh + coreutils 单 exe）到 `~/.anycode/runtime/busybox/sh.exe`——保证 agent 的 bash 工具在 Windows 与 Linux 行为一致。首装无 config 时 bash 工具自动发现 busybox 下发位置。
6. 下载校验：node 包 sha256 校验，不符即终止。

## 目录布局

```
~/.anycode/
├── config.yaml / memory.md / workspaces.json / skills/   # 用户配置（安装不动）
├── runtime/node/            # 私有 node 运行时
├── runtime/busybox/         # 仅 Windows：busybox-w32 sh.exe（agent bash 工具用）
├── app/                     # 仓库代码 + 构建产物（web/dist 静态 SPA + server/dist/server.mjs）
└── bin/anycode / anycode.cmd  # 2 行 shim → launcher.mjs（注册到 PATH）
```

## 卸载

```
rm -rf ~/.anycode      # Linux
Remove-Item -Recurse -Force ~\.anycode   # Windows
```

并手动从 shell rc / User PATH 删掉 `~/.anycode/bin` 一行（可选，留着也无害）。

## 更新

`anycode update` 重跑平台安装器（幂等：已装的 node/pnpm/busybox 复用，仅拉新代码 + 重建）；`anycode uninstall` 卸载。

## 文件

| 文件 | 作用 |
|---|---|
| `install.sh` | Linux 一行安装器（curl\|bash 拉取） |
| `install.ps1` | Windows 一行安装器（iwr\|iex 拉取） |
| `install.bat` | Windows cmd/双击入口（薄 shim→ps1） |
| `launcher.mjs` | `anycode web` 启动器（node，跨平台；安装器生成薄 shim 调用它） |
| `versions.env` | 版本配置（node LTS 等） |

## 平台支持

v1：Windows + Linux。
- **Linux**：跑 `install.sh`。
- **Windows**：跑 `install.ps1`（PowerShell 一行）。兜底：若在 Git Bash 里跑了 `install.sh`，它会检测到 MINGW/MSYS 环境自动改走 `install.ps1`（不在 bash 里重写 Windows 逻辑）。
- macOS（安装脚本）、代码签名（SmartScreen/Gatekeeper）与桌面自动更新作为后续特性；Electron 桌面客户端已提供（desktop/ 打包 AppImage/NSIS/mac zip）。
