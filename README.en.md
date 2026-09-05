# AnyCode

[简体中文](./README.md) | **English**

> **A Simple AI Agent** — Simplicity is capability; restraint is a choice.

A lightweight **local AI coding agent**: it runs on your machine — reading code, running commands, editing files — to complete the coding tasks you give it. Your code and commands never leave your computer. Works with any OpenAI-compatible model (Anthropic protocol supported too).

**Four entry points**: Web UI (recommended) · Desktop app (Electron) · Terminal TUI (WIP) · CLI

## Install

Linux (bash / zsh / fish):

```bash
curl -fsSL https://raw.githubusercontent.com/anyJohn/any-code/main/build/install.sh | bash
```

Windows (PowerShell):

```powershell
iwr -useb https://raw.githubusercontent.com/anyJohn/any-code/main/build/install.ps1 | iex
```

Open a **new terminal** and run `anycode web` — the browser opens `http://127.0.0.1:3000` automatically. See [build/README.md](./build/README.md) for details; other commands: `anycode update` / `uninstall` / `help`.

## Quick Start

1. Run `anycode web` to open the browser UI
2. Click "Add Workspace" in the top bar and pick a local directory — the agent works inside it
3. Add your model API key in `/settings` (or edit `~/.anycode/config.yaml` directly)
4. Start a new chat and describe a task, e.g. *list the TypeScript files in this directory and explain each one*

The agent completes the task by calling tools on its own — thinking, tool calls and answers stream live, grouped by turn. Stop anytime. **Switching sessions or closing the tab does not stop a running task**; multiple projects can run in parallel.

> ⚠️ **Security**: the `bash` tool executes LLM-generated commands on your machine. The server listens on **127.0.0.1 only** — never expose it to the public internet. A built-in permission system (allow / ask / deny + dangerous-command confirmation) provides guardrails.

## Highlights

- **Reactive agent kernel**: RxJS-driven reasoning loop; real cancellation (AbortController reaches in-flight LLM calls)
- **Multi-provider**: OpenAI-compatible + Anthropic protocol, hot-switchable; automatic context-window detection
- **Tool system**: bash / file read-write / glob-grep (ripgrep) / MCP (stdio·SSE + connection pooling); permission modes (standard / accept-edits / trusted) + dangerous-command baseline; parallel execution; JSON-Schema argument validation
- **Context management**: tiered compaction (micro → summary) + overflow recovery; shadow-git snapshots and `/rewind`
- **Sessions**: persisted & replayable; background runs and multi-agent parallelism (stops only when the app exits); usage & cost tracking (optional `pricing`); log invariant (crash-safe context rebuild)
- **Extensibility**: project-level skills / rules / custom tools / lifecycle hooks under `.anycode/`; sub-agent delegation and plan mode
- **UI**: single codebase for Web / Desktop; one-click English-Chinese switching; per-session permission dialogs with cross-session reminders

Full list: [feature-list.md](./feature-list.md).

## Configuration

Global `~/.anycode/config.yaml`, or edit visually in `/settings` (hot reload):

```yaml
providers:
  openai:
    apiKey: sk-your-key
    models: [{ id: gpt-4o, name: GPT-4o }]
    defaultModel: gpt-4o
default: openai
mcp: {}          # optional: MCP servers (stdio / SSE); project-level .anycode/mcp.yaml overrides
pricing:         # optional: model unit prices ($/1M tokens); cost shown only when configured
  gpt-4o: { input: 2.5, output: 10 }
```

A workspace root may contain a gitignored `.anycode/` directory: `memory.md` (cross-session memory), `skills/`, `rules/`, `tools/*.mjs` (custom tools), `hooks.mjs` (lifecycle hooks), `permissions.yaml` (project permission rules), `mcp.yaml` (project MCP).

## Development

```bash
git clone https://github.com/anyJohn/any-code.git any-code && cd any-code
pnpm install
pnpm dev:server      # hono server (tsx watch, 127.0.0.1:3000)
pnpm dev:web         # Vite (5173, proxies /api → 3000)
pnpm build && pnpm test
```

Monorepo (pnpm workspace): `domain` (agent kernel, pure ESM) · `server` (hono HTTP adapter, 29 routes) · `web` (Vite SPA) · `desktop` (Electron) · `tui` (Ink, WIP) · `build` (one-line installer).

## Roadmap

Staying true to the "minimal readable kernel" positioning: **small but complete + real-protocol ecosystem + lightweight orchestration**. See [feature-list.md](./feature-list.md) for everything shipped.

- **Planned**: ACP lightweight orchestration / CI-CD / desktop code signing & auto-update / RAG cross-session long-term memory (far future)
- **Explicitly not doing**: everything-is-a-plugin framework · messaging-platform gateways · process-level sandbox (permission system suffices) · scope expansion

## Contributing

Issues and PRs welcome. Before submitting: `pnpm build` passes, `tsc --noEmit` clean, consistent style (prettier defaults).

## License

MIT — see [LICENSE](./LICENSE).
