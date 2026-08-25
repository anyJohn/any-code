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
anycode --web
```

浏览器自动打开 `http://127.0.0.1:3000`，即 web 端 agent。`Ctrl+C` 停止服务。

## 安装器做了什么

1. **私有 provision node**：下载 nodejs.org LTS 到 `~/.anycode/runtime/node`。下载 pnpm standalone（`pnpm/pnpm` releases）到 `~/.anycode/runtime/pnpm`（绕开 corepack 0.29 验签 bug）。不写系统 PATH、不要 sudo / admin。
2. **拉取仓库**：从 GitHub 下载 tarball / zip（codeload，不依赖系统 git）解压到 `~/.anycode/app`。
3. **构建**：`pnpm install --frozen-lockfile` + `pnpm --filter @any-code/web build`（next build）。
4. **注册命令**：复制启动器到 `~/.anycode/bin/anycode` 并把该目录加到用户 PATH（Linux patch shell rc；Windows User PATH）。
5. **Windows 额外**：下载 PortableGit（含 bash.exe + coreutils）到 `~/.anycode/runtime/portablegit`，并把 bash 路径写入 `~/.anycode/config.yaml` 的 `gitBashPath`（config 是单一可信源，非 env var）——保证 agent 的 bash 工具在 Windows 与 Linux 行为一致。首装无 config 时 bash 工具自动发现 PortableGit 下发位置。
6. 下载校验：node 包 sha256 校验，不符即终止。

## 目录布局

```
~/.anycode/
├── config.yaml / memory.md / workspaces.json / rules/ / skills/   # 用户配置（安装不动）
├── runtime/node/            # 私有 node 运行时
├── runtime/portablegit/     # 仅 Windows：PortableGit（agent bash 工具用）
├── app/                     # 仓库代码 + node_modules + web/.next 构建产物
└── bin/anycode(.bat)        # 启动器（注册到 PATH）
```

## 卸载

```
rm -rf ~/.anycode      # Linux
Remove-Item -Recurse -Force ~\.anycode   # Windows
```

并手动从 shell rc / User PATH 删掉 `~/.anycode/bin` 一行（可选，留着也无害）。

## 更新

v1 无自更新：重跑安装命令即可（已装的 node/PortableGit 会复用，仅拉新代码 + 重建）。后续会加 `anycode update`。

## 文件

| 文件 | 作用 |
|---|---|
| `install.sh` | Linux 一行安装器（curl\|bash 拉取） |
| `install.ps1` | Windows 一行安装器（iwr\|iex 拉取） |
| `install.bat` | Windows cmd/双击入口（薄 shim→ps1） |
| `launcher.sh` | `anycode --web` Linux 启动器 |
| `launcher.bat` | `anycode --web` Windows 启动器 |
| `versions.env` | 版本配置（node LTS 等） |

## 平台支持

v1：Windows + Linux。macOS、Electron 桌面客户端、代码签名（SmartScreen/Gatekeeper）作为后续特性。
