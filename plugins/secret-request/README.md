# secret-request

Let a Paseo agent ask the user for one secret — an API key, token or password — inside the conversation, without the value ever becoming a chat message.

The agent calls the `request_secret` MCP tool, which blocks until the user answers. The plugin renders a card in the timeline; the typed value travels plugin RPC to the daemon, is written once to a `0600` file on a RAM-backed mount, and the blocked tool call returns that file path. The agent reads the file with `$(cat <path>)`, and the file is deleted automatically. Nothing is stored, granted or reused.

Requires Paseo 0.10.2 or newer and a Linux host with a usable `/dev/shm`.

## Agent tools

Bound to the owning agent through a persisted bearer token on a loopback HTTP listener; the port is retained across plugin reloads.

- `request_secret({label, description?, hint?, expectedLength?})` — blocks until the user submits, cancels, or the request is gone. Returns `{status, requestId, label, path, handoffExpiresAt, message}`. Idempotent per agent and label while a request is pending, so a provider-side request timeout that makes the agent retry resumes the same wait instead of stacking a second card. The card append retries briefly when the agent is not loaded yet, which is the state right after a daemon restart.
- `secret_status({requestId? , label?})` — answers without waiting: `pending`, `delivered`, `canceled` or `gone`.
- `secret_release({requestId})` — deletes the handoff file as soon as the agent is done with it.

New sessions receive the MCP server plus an instruction that states the tool blocks, that the result is a path and never the value, that the value must never be echoed, logged or copied, and that the card accepts a single line.

## Handoff

`/dev/shm/paseo-<uid>-secret-request/<handoffId>/<requestId>`, mode `0600`, owned by the daemon user.

- `/dev/shm` and both directories are checked with `lstat` (real directory, current uid, `0700`, not a symlink) and `fs.statfs` (`TMPFS_MAGIC`) before the first request and at plugin start. If any check fails — no `/dev/shm`, not tmpfs, read-only, full — `request_secret` returns an error and **no card is shown**: the plugin never falls back to a persistent filesystem for a secret.
- The per-daemon `handoffId` scopes the startup purge, so two daemons on one host never delete each other's live handoffs.
- The file is deleted 15 minutes after delivery, on `secret_release`, on cancel, on agent archive, on plugin reload and on plugin start. A reboot clears the rest.
- `state.json` under `PASEO_HOME/plugin-data/secret-request/` holds the MCP port, the handoff scope and the agent token bindings — never a value.

## Client card

`client/card.tsx` exports `SecretRequestCard`, registered by `index.client.tsx` with `addTimelineRenderer({ kind: "secret-request", version: 1 })`. The card is the only client contribution; there is no panel, settings screen, sidebar item or slash command.

The field is a masked single line (`secureTextEntry`). The typed value lives only in a ref, is never rendered, and is cleared on submit, cancel, unmount and on any terminal status read. Submit sends the value trimmed of leading and trailing whitespace; an empty send is rejected inline, and `expectedLength` produces warnings only.

States: `pending` (with hint and idle substates), `sending`, `delivered` with a live countdown to `handoffExpiresAt`, `canceled`, plus the client-derived `gone` and the `unavailable`, `rpcError` and `offline` overlays. Terminal states remove the input entirely.

RPC calls use `submitRpc`, `cancelRpc` and `statusRpc` from `shared/contracts.ts`. `statusRpc` resolves the `gone` state and recovers after a connection loss; a submit is never retried automatically, because a repeat could be a second delivery attempt. Copy is bilingual (English and Simplified Chinese), selected from the device locale through `Intl.DateTimeFormat`. Every control carries an accessibility label and role, and every observable element has a stable `testID`.

## Limits

- A web client cannot hold newlines: `secureTextEntry` compiles to `type="password"` and the browser strips CR/LF from that input, so a pasted PEM or SSH key arrives as one line. The plugin stores what it receives and does not guess; the injected instruction tells the agent to ask for a base64 form through `hint` when it needs a multi-line secret intact.
- The value sits in RAM for up to 15 minutes and is readable by the daemon user and root; on a host with unencrypted swap, tmpfs pages can be paged out.
- The value crosses the client ↔ daemon transport. A phone or remote client should be on the relay's E2EE path, which the plugin can neither detect nor enforce.
- An agent that echoes the value, or a command that prints it, leaks it into history on its own; the plugin cannot stop that.
- Agents created before the plugin was installed do not receive the MCP server automatically.

## Development and verification

Paseo compiles the source; no plugin bundler is required. Run `pnpm --filter @pelikanade/paseo-plugin-secret-request typecheck`, then `pnpm format` and `pnpm check`.

`e2e/secret-request.e2e.mjs` runs against an isolated real daemon, the real MCP transport and the real Web UI: the blocked call, the `0600` tmpfs path, delivery through the browser card, cancel, idempotent submit, `secret_release`, plugin reload and daemon restart deletion, archive abort, and a `mount`-namespace scenario where `/dev/shm` is not tmpfs and the request must be refused. It also asserts the sentinel value appears in the handoff file and in no timeline, log or `PASEO_HOME` file.

Two things it does not clear, both stated rather than hidden:

- **The 15-minute expiry timer** is not covered end to end: the suite asserts the returned deadline and exercises the same deletion through `secret_release`, cancel, archive, reload and start, but does not wait 15 minutes.
- **The environment must give the browser a font configuration.** Without one, Chromium registers no fonts at all: text renders as nothing (Playwright reports every text node as hidden) and typing inserts nothing anywhere — `keydown` bubbles with `defaultPrevented === false` and then no `beforeinput` or `input` event follows, `locator.fill` and CDP `Input.insertText` leave the value empty, and a plainly injected focused `<input>` behaves the same. The suite names that as one scenario, `a browser can deliver keyboard text to the card field`, which carries the plain-input control probe so its failure message points at the environment rather than the plugin. With

```sh
FONTCONFIG_FILE=/tmp/fc/fonts.conf pnpm test:e2e
```

(see `docs/known-issues/0001-e2e-browser-needs-fontconfig.md` for the file's contents) the suite passes **6 of 6**, including typing into the card, and the pre-existing `generative-ui` browser suite passes too.

See `design/plugin-secret-input-request/` for the full specification and design.
