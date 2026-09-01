# @any-code/tui

> Terminal UI for AnyCode, built with Ink（早期，开发中）。

## Install

```bash
pnpm install
pnpm build
```

## Usage

```bash
# Development
pnpm dev

# Build and run
pnpm build
pnpm start
```

## Options

| Option      | Description                                  |
| ----------- | -------------------------------------------- |
| （无参数）   | 新会话；配置读 `<workspace>/.anycode/config.yaml` |
| `--resume`  | 按 id 恢复指定会话                             |
| `--continue`| 恢复最近一条会话                               |
| `--sessions`| 列出当前项目的会话后退出                        |

## Commands

- `/resume` — 选择并恢复历史会话
- `/help` — 显示可用命令
