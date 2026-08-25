#!/usr/bin/env bash
# anycode --web：用私有 node 起 next start（仅 127.0.0.1）+ 开浏览器 + 前台（Ctrl+C 停止）。
# 由 install.sh 复制到 ~/.anycode/bin/anycode。
set -euo pipefail

ANYCODE_HOME="${ANYCODE_HOME:-$HOME/.anycode}"
APP="$ANYCODE_HOME/app"
WEB="$APP/web"
NODE_BIN="$ANYCODE_HOME/runtime/node/bin"

[ -x "$NODE_BIN/node" ] || { echo "anycode 未正确安装：缺私有 node（$NODE_BIN/node）。请重装。" >&2; exit 1; }
[ -f "$WEB/node_modules/.bin/next" ] || { echo "anycode 未正确安装：缺 web 构建（$WEB/node_modules/.bin/next）。请重装。" >&2; exit 1; }

# 私有 node + web 的 bin 优先
export PATH="$WEB/node_modules/.bin:$NODE_BIN:$PATH"

# --port 覆盖；默认 3000，占用则自增到空闲（DEC-091）
PORT=3000
for a in "$@"; do
    case "$a" in
        --port=*) PORT="${a#--port=}" ;;
        --web) ;; # 唯一模式，no-op
        *) echo "未知参数：$a（当前仅支持 --web / --port=N）" >&2 ;;
    esac
done
START="$PORT"
if command -v ss >/dev/null 2>&1; then
    while [ "$PORT" -lt $((START + 20)) ]; do
        if ss -ltn 2>/dev/null | grep -q ":$PORT "; then PORT=$((PORT + 1)); else break; fi
    done
fi

URL="http://127.0.0.1:$PORT"
echo "启动 anycode web → $URL （Ctrl+C 停止）"

# 服务就绪后开浏览器（后台，最多等 15s）
(
    for _ in $(seq 1 30); do
        sleep 0.5
        if command -v curl >/dev/null 2>&1 && curl -s -o /dev/null "$URL" 2>/dev/null; then
            command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" 2>/dev/null || true
            break
        fi
    done
) &

cd "$WEB"
exec next start -H 127.0.0.1 -p "$PORT"
