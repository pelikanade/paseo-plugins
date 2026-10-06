# paseo-omp-compat

Makes omp agents launched through Paseo adopt the "Paseo first" directive natively, by appending it to the agent session's system prompt on the daemon. It is the single source of that directive; no user-level `APPEND_SYSTEM.md` is needed.

Requires Paseo `>=0.10.2`.

## What it injects

The `agent.create` lifecycle hook is the only hook that carries `config.systemPrompt` in 0.10.2 (`agent.session_open` can only change `env`). For every non-internal agent the plugin:

- appends the directive after any existing system prompt, separated by a blank line;
- skips the append when the prompt already contains a line equal to `# Paseo first` (the sentinel), so it is never added twice;
- skips it when `enabled` is `false`;
- uses `textOverride` instead of the built-in text when that setting is non-empty;
- logs and passes the request through unchanged if anything throws.

The built-in directive is the original text plus one added section, "Showing images". Paseo 0.10.2 drops image blocks that omp tools return, so assistant markdown `![alt](source)` is the only way an image reaches the chat. The section lists the sources checked to render in the Paseo chat: an absolute local path, a `file://` URL, an `http(s)://` URL, and a `data:` URI. A relative path also rendered in a manual check, but its base directory was not established, so the directive tells agents to use absolute paths.

The omp provider delivers the prompt as `--append-system-prompt`, and persists it, so resumed sessions keep it. The built-in text lives in `shared/paseo-first.ts`.

The hook also tags the create request with a one-shot `PASEO_OMP_COMPAT_STATE` environment entry. The `agent.session_open` hook for the same session records it against the agent id and removes it, so it never reaches the provider process. The record is in memory: after a daemon restart, or for agents created while the plugin was not installed, the status is reported as unknown.

## Settings

Open the "Paseo first" settings screen, or edit through the settings RPC.

| Setting        | Default | Meaning                                                              |
| -------------- | ------- | -------------------------------------------------------------------- |
| `enabled`      | `true`  | Append the directive to new agents.                                  |
| `textOverride` | `""`    | Directive text to use instead of the built-in one. Empty = built-in. |

Changes affect agents created afterwards. Running agents keep the prompt they started with. An override should keep a `# Paseo first` line if you want the idempotency check to recognise it.

## Verify

- In an agent's composer, run `/paseo-first`. The panel reports whether the directive is active for that agent and whether the text came from the built-in directive, the override, or was already present in the requested prompt.
- Inspect the provider process: an omp agent launched through Paseo has `--append-system-prompt` in its command line, containing `# Paseo first` once.
- Repository check: `pnpm test:e2e` runs `e2e/paseo-omp-compat.e2e.mjs` against an isolated real daemon and a real `omp` process. It needs `omp` on `PATH`; it uses a placeholder API key and never sends a model turn.
