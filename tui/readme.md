# @any-code/tui

> Terminal UI for AnyCode, built with Ink.

## Install

```bash
pnpm install
pnpm build
```

## Usage

```bash
# Development
pnpm dev

# With options
pnpm dev -- --api-key=sk-xxx --model=gpt-4 --base-url=https://api.openai.com/v1

# Build and run
pnpm build
pnpm start
```

## Options

| Option       | Env Var          | Description    |
| ------------ | ---------------- | -------------- |
| `--api-key`  | `OPENAI_API_KEY` | LLM API key    |
| `--base-url` | `OPENAI_BASE_URL`| API base URL   |
| `--model`    | `OPENAI_MODEL`   | Model name     |
