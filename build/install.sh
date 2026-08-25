#!/usr/bin/env bash
# anycode Linux 一行安装器（curl | bash 拉取执行）。
# 流程：私有 provision node（nodejs.org tarball）+ pnpm standalone（绕开 corepack 0.29 验签 bug）
# → 拉仓库 tarball（不依赖 git）→ pnpm install + next build → 注册 anycode 到 PATH。
# 不碰系统 PATH、不要 sudo；用户机仅需 curl + tar。
set -euo pipefail

# ===== CONFIG（与 versions.env 同值）=====
ORG=anyJohn
REPO=any-code
BRANCH=main
NODE_VERSION=v22.11.0
PNPM_VERSION=11.8.0
ANYCODE_HOME="${ANYCODE_HOME:-$HOME/.anycode}"
# 顶部断言：ANYCODE_HOME 须在 $HOME 下（挡住空/根/异常值，保护后续 rm -rf 锚定）
case "$ANYCODE_HOME" in
    "$HOME"/*) : ;;
    *) echo "✗ ANYCODE_HOME 须在 \$HOME 下（当前：$ANYCODE_HOME）" >&2; exit 1 ;;
esac
# ======================================

err() { echo "✗ anycode 安装失败：$*" >&2; exit 1; }
info() { echo "▶ $*"; }
# 安全删除：仅在"非空 + 是目录 + 锚定在 ANYCODE_HOME 下"才 rm -rf，否则报错不动。
safe_rm() {
    local p="$1"
    [ -n "$p" ] && [ -d "$p" ] || return 0
    case "$p" in
        "$ANYCODE_HOME"/*) rm -rf -- "$p" ;;
        *) err "safe_rm 拒绝删除 $p（不在 $ANYCODE_HOME 下）" ;;
    esac
}

command -v curl >/dev/null 2>&1 || err "需要 curl（请先安装）"
command -v tar >/dev/null 2>&1 || err "需要 tar（请先安装）"

# OS 探测：Windows（Git Bash / MSYS / Cygwin）改走 install.ps1——复用 PowerShell 的 Windows
# 安装逻辑（win 平台 node zip + pnpm win zip + PortableGit + config.gitBashPath），不在 bash 重写。
KERNEL="$(uname -s)"
case "$KERNEL" in
    MINGW*|MSYS*|CYGWIN*)
        info "检测到 Windows（$KERNEL，Git Bash/MSYS/Cygwin）——改走 install.ps1（PowerShell）执行 Windows 安装…"
        PS_URL="https://raw.githubusercontent.com/$ORG/$REPO/$BRANCH/build/install.ps1"
        powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -useb '$PS_URL' | iex" \
            || err "install.ps1 执行失败（见上方输出）"
        exit 0
        ;;
    Darwin*)
        err "macOS 暂不支持（本次范围 Linux + Windows）"
        ;;
    Linux*)
        : ;;
    *)
        err "不支持的系统：$KERNEL（仅支持 Linux 与 Windows）"
        ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64) NODE_ARCH=linux-x64 ;;
    aarch64|arm64) NODE_ARCH=linux-arm64 ;;
    *) err "不支持的架构：$ARCH（仅支持 x64 / arm64）" ;;
esac

info "目标目录：$ANYCODE_HOME"
mkdir -p "$ANYCODE_HOME/runtime" "$ANYCODE_HOME/app" "$ANYCODE_HOME/bin"
TMP="$(mktemp -d)"; trap '[ -n "$TMP" ] && [ -d "$TMP" ] && rm -rf -- "$TMP"' EXIT

# ---- 1. 私有 node（next start 运行时用）----
NODE_DIR="$ANYCODE_HOME/runtime/node"
if [ ! -x "$NODE_DIR/bin/node" ]; then
    info "下载 node $NODE_VERSION ($NODE_ARCH)…"
    TARBALL="node-$NODE_VERSION-$NODE_ARCH.tar.xz"
    URL="https://nodejs.org/dist/$NODE_VERSION/$TARBALL"
    curl -fsSL "$URL" -o "$TMP/$TARBALL" || err "下载 node 失败：$URL"
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
    ( cd "$TMP" && grep "  $TARBALL$" SHASUMS256.txt | sha256sum -c - ) || err "node 下载 sha256 校验失败"
    command -v xz >/dev/null 2>&1 || command -v unxz >/dev/null 2>&1 || err "需要 xz（解压 node tar.xz）"
    info "解压 node…"
    tar -xJf "$TMP/$TARBALL" -C "$TMP"
    safe_rm "$NODE_DIR"
    mv "$TMP/node-$NODE_VERSION-$NODE_ARCH" "$NODE_DIR"
fi
info "node: $("$NODE_DIR/bin/node" -v)"

# ---- 2. pnpm standalone（绕开 corepack 0.29 验签 bug；自带 node）----
PNPM_DIR="$ANYCODE_HOME/runtime/pnpm"
if [ ! -x "$PNPM_DIR/pnpm" ]; then
    if ldd --version 2>&1 | head -1 | grep -qi musl; then
        PNPM_ASSET="pnpm-linux-x64-musl.tar.gz"
    else
        case "$ARCH" in
            x86_64) PNPM_ASSET="pnpm-linux-x64.tar.gz" ;;
            aarch64|arm64) PNPM_ASSET="pnpm-linux-arm64.tar.gz" ;;
        esac
    fi
    info "下载 pnpm $PNPM_VERSION ($PNPM_ASSET)…"
    URL="https://github.com/pnpm/pnpm/releases/download/v$PNPM_VERSION/$PNPM_ASSET"
    curl -fsSL "$URL" -o "$TMP/pnpm.tgz" || err "下载 pnpm 失败：$URL"
    mkdir -p "$PNPM_DIR"
    tar -xzf "$TMP/pnpm.tgz" -C "$PNPM_DIR"
fi
export PATH="$PNPM_DIR:$NODE_DIR/bin:$PATH"
info "pnpm: $(pnpm --version)"

# ---- 3. 拉仓库 ----
APP="$ANYCODE_HOME/app"
if [ ! -f "$APP/package.json" ]; then
    # REPO_TARBALL_URL 覆盖：支持自定义 fork/mirror/离线 file:// 快照。默认 GitHub codeload。
    REPO_URL="${REPO_TARBALL_URL:-https://github.com/$ORG/$REPO/archive/refs/heads/$BRANCH.tar.gz}"
    info "拉取仓库（$REPO_URL，不依赖 git）…"
    curl -fsSL "$REPO_URL" -o "$TMP/repo.tar.gz" || err "下载仓库失败：$REPO_URL"
    tar -xzf "$TMP/repo.tar.gz" -C "$TMP"
    EXTRACTED="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d | head -1)"
    [ -n "$EXTRACTED" ] && [ -f "$EXTRACTED/package.json" ] || err "仓库解压后未找到 package.json"
    safe_rm "$APP"
    mv "$EXTRACTED" "$APP"
fi

# ---- 4. 构建 ----
cd "$APP"
info "pnpm install（可能数分钟）…"
pnpm install --frozen-lockfile
info "构建 web（next build → standalone）…"
pnpm --filter @any-code/web build

# ---- 4b. standalone post-process：vendor rg / 拷 static / 删 build-only 依赖 ----
info "post-process standalone..."
# 1. vendor rg 二进制（standalone 不含 @vscode/ripgrep 平台二进制；直接 find 定位，避开 ESM require 问题）
RG_DIR="$ANYCODE_HOME/runtime/rg"
mkdir -p "$RG_DIR"
RG_SRC="$(find "$APP/node_modules/.pnpm" -type f \( -name rg -o -name rg.exe \) 2>/dev/null | head -1)"
if [ -n "$RG_SRC" ] && [ -f "$RG_SRC" ]; then
    cp "$RG_SRC" "$RG_DIR/$(basename "$RG_SRC")"; chmod +x "$RG_DIR/$(basename "$RG_SRC")"
else
    err "未找到 ripgrep 二进制（@vscode/ripgrep 平台包）"
fi
# 2. 拷 static + public 进 standalone（server.js 从 standalone/web/.next/static 服务）
STANDALONE_WEB="$APP/web/.next/standalone/web"
mkdir -p "$STANDALONE_WEB/.next"
cp -r "$APP/web/.next/static" "$STANDALONE_WEB/.next/static"
[ -d "$APP/web/public" ] && cp -r "$APP/web/public" "$STANDALONE_WEB/public"
# 3. 只留 .next/standalone（运行时）；删其余 build traces（~280MB）
for d in "$APP/web/.next"/*; do
    [ "$(basename "$d")" = "standalone" ] && continue
    safe_rm "$d"
done
# 4. 删 build-only node_modules + pnpm（standalone 自包含；~860MB）。safe_rm 锚定守卫。
safe_rm "$APP/node_modules"
safe_rm "$PNPM_DIR"

# ---- 5. 注册 anycode 到 PATH (generate thin sh shim) ----
# launcher logic in build/launcher.mjs (node); sh shim just execs private node + launcher.mjs.
ANYCODE_SH="$ANYCODE_HOME/bin/anycode"
LAUNCHER_MJS="$APP/build/launcher.mjs"
NODE_BIN_SH="$ANYCODE_HOME/runtime/node/bin/node"
mkdir -p "$ANYCODE_HOME/bin"
cat > "$ANYCODE_SH" <<SHIM
#!/bin/sh
exec "$NODE_BIN_SH" "$LAUNCHER_MJS" "\$@"
SHIM
chmod +x "$ANYCODE_SH"

PATH_LINE='export PATH="$HOME/.anycode/bin:$PATH"'
patch_rc() {
    local rc="$1"
    [ -f "$rc" ] || return 0
    grep -qF '.anycode/bin' "$rc" 2>/dev/null || printf '\n# anycode\n%s\n' "$PATH_LINE" >> "$rc"
}
patch_rc "$HOME/.bashrc"
patch_rc "$HOME/.zshrc"
FISH_RC="$HOME/.config/fish/config.fish"
if [ -d "$(dirname "$FISH_RC")" ] || [ "$SHELL" = "/bin/fish" ]; then
    mkdir -p "$(dirname "$FISH_RC")"
    grep -qF '.anycode/bin' "$FISH_RC" 2>/dev/null || printf '\n# anycode\nset -x PATH $HOME/.anycode/bin $PATH\n' >> "$FISH_RC"
fi

echo
echo "✓ anycode 安装完成！"
echo "  打开新终端（或 source ~/.bashrc），运行：anycode --web"
echo "  浏览器自动打开 http://127.0.0.1:3000"
