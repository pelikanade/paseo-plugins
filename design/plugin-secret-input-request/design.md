# secret-request — design (one-shot, blocking)

Status: design settled (all decisions recorded), not implemented. Plugin id `secret-request`, package `@pelikanade/paseo-plugin-secret-request`, `requirements.paseo: ">=0.10.2"`.

Scope is a single gesture: an agent asks the user for one secret, the user types it into a card in the conversation, the agent uses it, nothing is kept. No vault, no settings screen, no grants, no reuse across sessions, no long-term storage.

## Invariants

- **I1 — the value is never chat history.** Not a `user_message`, not an `assistant_message`, not an MCP tool argument, not an MCP tool result, not a plugin timeline item's `data`, not an RPC error, not a log line.
- **I2 — the value must be usable in the same turn.** The tool call blocks until the user answers, so the agent gets a usable handle without ending its turn.
- **I3 — the value is transient and never touches persistent storage.** It lives in daemon memory and in one RAM-backed file under `/dev/shm`, deleted on release, on TTL expiry, on cancel, on plugin reload and on daemon start. If the host cannot provide a RAM-backed handoff, the request fails before the card appears rather than falling back to disk.

## Why blocking forces a file handoff

Environment-variable injection cannot be part of a blocking answer in 0.10.2:

- `env` is fixed when the provider process starts. The only way a plugin changes it is the `agent.session_open` hook, and that hook runs on `create` / `resume` / `refresh` / `import` — never mid-turn.
- Forcing a re-open means daemon-client `refreshAgent`, which first calls `interruptAgentIfRunning` → `cancelAgentRun` (`session.js:868+`, `session.js:3344-3357`). The turn that is waiting on the tool call is canceled, the MCP connection dies, and the pending tool result is lost.

So a blocking request must deliver something the running turn can consume immediately: a path to a file whose contents are the secret. That is the entire reason for the handoff file — it is not a convenience, it is the only channel that survives the turn boundary.

## Flow

1. Agent calls MCP tool `request_secret({label, description?, hint?, expectedLength?})`. The call blocks until the user answers.
2. Server creates a request `{requestId, agentId, label, description?, hint?, status:"pending", createdAt}`, appends a plugin timeline item `{kind:"secret-request", version:1, data:<record>}` — metadata only, never the value — and starts waiting. The call is idempotent per agent and label while a request is pending, so a provider-side request timeout that makes the agent retry resumes the same wait instead of stacking a second card.
3. Client renders the card in the conversation (see `ui-spec.md`). Masked input, submit, cancel.
4. On submit the client calls `secrets.submit({agentId, requestId, value})`; the value travels plugin RPC → daemon memory → the RAM-backed handoff file `/dev/shm/paseo-<uid>-secret-request/<requestId>`, written with mode `0600`. The client clears its buffer; the value is never sent anywhere else and never written to a persistent filesystem.
5. The blocked tool call returns `{status:"delivered", requestId, label, path, handoffExpiresAt}`. The agent uses the secret in the same turn, typically `curl -H "Authorization: Bearer $(cat <path>)"`.
6. Cleanup: the file is deleted when the TTL passes (default 15 minutes), when the agent calls `secret_release({requestId})`, when the request is canceled, when the agent is archived (which also aborts its pending requests with `{status:"gone"}`), when the plugin reloads, and when the plugin starts — so a previous unclean shutdown, a reboot or a plugin reload leaves nothing in `/dev/shm`. The timeline item is re-appended with its terminal status.
7. If the user cancels, the blocked call returns `{status:"canceled"}`, and the agent is told the user declined — no waiting, no silent drop.
8. The wait has no internal time limit. `secret_status({requestId | label})` answers without waiting, and a repeated `request_secret` with the same label while the first is pending resumes the same wait.

## Plugin surface

- MCP server: loopback HTTP on a retained port with a bearer token bound to the agent, exactly as `plugins/generative-ui/server/mcp.ts` does. Tools: `request_secret` (blocking, idempotent per agent and label while pending), `secret_status`, `secret_release`. Injected for new sessions by `server.before("agent.create")` together with an instruction that states: the tool blocks until the user answers; the result is a path, never the value; never echo, print or log the value; never report its length, prefix, suffix or hash either, because size and fragments are metadata that narrows a guess; the input box accepts a single line, so a multi-line secret (PEM, SSH key, service-account JSON) either has to be base64-encoded by the user — say so in `hint` with the exact command — or will arrive with its newlines stripped and must then be repaired by reading a bounded prefix of the handoff file rather than its whole contents. That last clause was added after the first real-machine run, where the agent volunteered the byte count of a delivered value.
- Client: `addTimelineRenderer({kind:"secret-request", version:1, schema, Component})` plus the two RPCs `secrets.submit` and `secrets.cancel`. No panel, no settings screen, no command center item, no slash command.
- `secret-request.connection` returns the loopback URL and the bearer token bound to an agent. It exists for the E2E run and for tooling, mirroring `plugins/generative-ui`'s `connection` RPC; the daemon's own client is already trusted, and the RPC exposes no value.
- State on disk: `PASEO_HOME/plugin-data/secret-request/state.json`, `0600`, holding only the retained MCP port, the handoff scope and the agent token bindings — no secret ever reaches it. Values live only under `/dev/shm`.

`secrets.submit` is idempotent for a request that already reached `delivered`: a retry after a lost response returns the same `{status:"delivered", handoffExpiresAt}` instead of an error, and never writes a second file. For a closed request (`canceled`) or an unknown one (`gone`) it returns a terminal error with a reason, and the card resolves to its terminal state after a status read.

## Value contract

- `label` is free text for a human: "Test password". It carries no environment-variable semantics, no name rules, and is never interpolated into a command, a path or an env map. The request is identified by `requestId`; `label` exists for the card and for the agent's own retry.
- `description` and `hint` are optional sentences shown in the card; `expectedLength` is an optional integer used for a warning, never a blocker — an agent's guess must not stand between the user and the submit button.
- The value is trimmed of leading and trailing whitespace on submit, and the server stores exactly what it receives: no reformatting, no re-encoding, no re-wrapping. The handoff file gets those bytes with no added trailing newline, so `$(cat <path>)` yields exactly what was submitted.
- Interior newlines cannot be typed or pasted on the web client: `secureTextEntry` compiles to DOM `type="password"` (verified in the host bundle), and the HTML value sanitization algorithm strips CR/LF from such an input. A pasted PEM or SSH private key therefore arrives as one long line, the plugin has no way to tell that it was multiline, and it does not try to guess. Recovering a stripped key is the agent's job: its instructions tell it to read a bounded prefix of the handoff file for diagnosis, to repair the wrapping itself, or to ask the user for a base64 form through the next request's `hint`. A native client whose field can hold newlines would deliver them unmodified, and nothing in the server path would break.
- `hint` is therefore load-bearing for non-obvious shapes: it is where the agent tells the user how to supply a base64-encoded key or that a pasted PEM will need repair.
- Nothing but the value ever enters the handoff file, and the value never enters a log call, an error message, an RPC response, a timeline item or a message.

## Handoff location

`/dev/shm` only, verified, with no disk fallback by choice. The consequence is deliberate: on a host without a usable RAM-backed mount, the plugin refuses the request instead of quietly writing a secret to disk.

- Root: `/dev/shm/paseo-<uid>-secret-request`, created with mode `0700`, plus a per-daemon subdirectory named by a random `handoffId` persisted in `state.json`. Two daemons on one host share `/dev/shm`, so the scope makes the startup purge exact: a daemon clears only its own directory and can never delete a live handoff belonging to another daemon. The final path is `/dev/shm/paseo-<uid>-secret-request/<handoffId>/<requestId>`.
- Both directories are verified before use, and on every plugin start, with `lstat` (real directory, owned by the current uid, mode `0700`, not a symlink) and `fs.statfs` (`TMPFS_MAGIC`, `0x01021994`). Any check failing, or `/dev/shm` being absent, non-tmpfs, read-only or full, makes `request_secret` fail with a clear error and **no card is shown**: there is no point asking the user for a value that cannot be delivered safely.
- File: `<requestId>`, opened with `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` and mode `0600`, then verified by `fstat` before the value is written. Everything inside the daemon's own directory is removed on plugin start, so nothing survives a crash, a reboot or a reload.
- `state.json` (port, `handoffId`, tokens — no secrets) stays under `PASEO_HOME`, because it must outlive a restart; the values must not.
- Measured on the target host: `/dev/shm` is tmpfs (`statfs` type `0x1021994`), a `0700` subdirectory is writable by the daemon uid, and the machine has no swap. On a host with unencrypted swap, tmpfs pages can be paged out — `/dev/shm` is RAM-backed, not magically memory-only.

## Verified constraints in 0.10.2 (daemon read, call chains cited)

- Timeline is one-way: history flows provider → Paseo (`hydrateTimelineFromProvider`, `agent-manager.js:2141-2144`); nothing converts stored timeline items, `plugin` items included, back into provider prompt content, and plugin items are skipped by the activity curator (`activity-curator.js:110-143`). I1 holds against the timeline.
- `agent.session_open` env does reach the provider process (`agent-manager.js:3682-3695` → `plugins/lifecycle/index.js:94-103` → `spawn.js:29` → `paseo-env.js:14-23`), but only at session start — the fact that rules it out here.
- `paseo.agents.ref(id).refresh()` is a snapshot refetch only (`session.js:5725-5760`); the session-restarting call is daemon-client `refreshAgent` (`session.js:3344-3357`), which cancels the running turn. Both are now unused by this design, which is the point.
- The daemon redacts nothing but HTTP auth headers (`logger.js:19-35`); plugin stdout/stderr is captured verbatim (`plugins/runtime.js:867`) and timeline items are persisted as written. The plugin is the entire redaction layer, so the value must never enter a log call.
- A plugin-created timeline item is persisted in the daemon timeline store and survives reloads; after `rehydrateFromDisk` (`agent-manager.js:874`) items must be re-appended from plugin state, the rule generative-ui already implements.
- The append path is not gated on an idle agent: `appendTimelineItem` records and dispatches immediately (`agent-manager.js:1559-1576`), so the card can appear while the tool call is blocked.
- An unloaded agent rejects the append with `Unknown agent` (`requireAgent`), which happens after a daemon restart until something loads that agent from disk — the timeline fetch does (`session.js:5767` calls `ensureAgentLoaded`). `publish` therefore retries the append for about three seconds before giving up and failing the request, which the E2E's restart scenario exercises.
- A blocked tool call cannot deadlock the card. The MCP server runs inside the plugin child on its own loopback HTTP listener, while `secrets.submit` travels daemon → plugin as a `requestId`-keyed IPC request that is dispatched concurrently (`plugins/plugin-process.js:291` registers a plain `process.on("message")` handler that never awaits its predecessor) under a 30 s per-request `REQUEST_TIMEOUT_MS` (`plugins/runtime.js:15,349-356`). The submit handler is a file write, so that timeout is headroom, not a risk.

## Mirrors Paseo's native ask flow

Paseo already solves "block an agent until the user answers" for its own question tools, and this design copies its lifecycle rather than inventing one. Each provider maps its ask/question tool into `AgentPermissionRequest{kind:"question"}` (`omp/agent.js:446,477`, `claude/agent.js:698,2066`, `codex/async-questions.js:24`, `pi/extensions/pi-ask-user/index.js:34`, `opencode/v2/permissions.js:92`) with a structured `input.questions[]` payload, the client renders it, and the answer returns through the permission-response path with `selectedActionId` / `updatedInput` for free text. What the two share:

- **A pending registry keyed by a stable id, resolved by one client call.** Native: `pendingPermissions` resolved by `respondToPermission`. Ours: the plugin's in-memory request registry resolved by `secrets.submit`.
- **No timeout.** There is no permission-timeout constant anywhere in the daemon; a pending question waits as long as the user takes, which is what the unbounded block here reproduces.
- **In-memory, rebuilt only if the producer replays it.** `pendingPermissions` is a live-agent `Map` (`agent-manager.js:1160,2757`) refilled from provider history; the plugin's registry lives in the plugin child and is not persisted, which is exactly the `gone` state the card renders after a reload.
- **Cancel is a first-class answer, not a dropped request.** Native `behavior:"deny"` with `interrupt`; ours `{status:"canceled"}`.
- **Structured request payload.** `input.questions[]` for native, `{label, description, hint, expectedLength}` for ours — same idea, plus a masked field that a permission card cannot express.

Two deliberate differences:

- The value never travels the answer path. A native question's answer becomes the tool result and therefore history; ours becomes a file path, because that is the whole point of the plugin.
- A blocked secret request does not set `requiresAttention` / `attentionReason` — the plugin SDK exposes those as read-only — so Paseo shows the agent as running with an unanswered card rather than as "needs input". The card is the cue; nothing else marks the wait.
- The tool is not added to `toolPolicy.preapproved`: preapproval requires the provider to implement `applyToolPolicy`, and the daemon rejects an agent request otherwise (`agent-manager.js:3618-3622`), so setting it would risk breaking agent creation on some providers. Whether a native permission prompt appears before the card in each mode is measured by the E2E run, and preapproval is added only if the measurement justifies the risk.

## Limits, stated rather than hidden

- The wait has no internal limit. If the user neither submits nor cancels, the agent stays inside a blocked tool call; the cancel button, the 15-minute expiry and `secret_status` are the only exits. A provider that imposes its own MCP request timeout will surface a tool error in the transcript with no secret in it, and the request stays pending — a repeated `request_secret` with the same label resumes the same wait.
- The value sits in RAM for up to the TTL: in the provider-visible sense nothing, but as a tmpfs file it is readable by the daemon user and by root for that window, and on a host with unencrypted swap it can be paged out. There is no disk copy to scrub because there is no disk copy.
- Because there is no fallback, the feature is unavailable on hosts without a usable `/dev/shm` — macOS, Windows, and containers that do not mount one. The agent gets a clear error instead of a card.
- Multi-line secrets are not special-cased: the web input cannot hold newlines, so a pasted PEM or SSH key arrives as one line and the agent must repair it or ask again with a base64 instruction in `hint`. Deliberate simplicity, not an oversight — a masked multi-line field does not exist on any of the three platforms, and the alternative was a plaintext multi-line mode.
- Any process the agent spawns inherits nothing automatically: the agent has to read the file. An agent that echoes the value, or a command that prints it, leaks it into history on its own.
- The value crosses the client↔daemon transport: loopback or LAN is local; a phone or remote client needs the relay with E2EE, which the plugin can neither detect nor enforce.
- The secret is not reusable: the next session asks again. That is the trade for having no vault.
- Pre-existing agents do not receive the new MCP server automatically (same limitation as generative-ui); they need a session reload or a new agent.

## Verification plan (repository rules)

Real daemon, real Web UI, Playwright, no mocks, per `.agents/skills/paseo-plugin-e2e/SKILL.md`. Implemented in `e2e/secret-request.e2e.mjs`:

1. Install the plugin, create an agent, attach a real MCP client through `secret-request.connection`, list the tools, and assert `request_secret` stays blocked while the card is pending.
2. Submit a sentinel value; assert the blocked call returns the path, that the file sits under `/dev/shm/paseo-<uid>-secret-request/<handoffId>/`, is mode `0600`, owned by the daemon uid, reports `TMPFS_MAGIC` through `statfs`, and holds exactly the submitted text.
3. Assert the sentinel appears in the handoff file and **nowhere else the test can observe**: not in the timeline payload, not in the daemon stdout/stderr, not in the plugin logs, and in no file under `PASEO_HOME`.
4. Drive the real card in the Web UI: `type="password"` on the input, submit disabled while empty, delivery copy and countdown after submit, the value absent from the rendered DOM afterwards, and cancel as a first-class decline.
5. Idempotent submit writes no second file and returns the same deadline; `secret_status` reports a deadline within the 15-minute TTL; `secret_release` deletes the file and clears the deadline.
6. Deletion on plugin reload and on daemon restart, and a pending request aborted with `gone` when the agent is archived.
7. Refusal path: the daemon runs inside `unshare -rm` with a non-tmpfs directory bind-mounted over `/dev/shm`; `request_secret` returns an error, no card is appended, and nothing is written to disk. This required one harness extension (`runtime(t, {daemonCommand})` prefixes the daemon command; `daemonLog()` exposes its output).
8. Interaction shape: the run records whether a native permission prompt precedes the card for `request_secret` in the mode the harness uses. Two prompts for one gesture is a finding to act on, not something to leave unmeasured.

Observed and resolved: the card renders in the Web UI and the whole flow is verified in a real browser — label, masked `type="password"` input, submit enabling on text, delivery, countdown, cancel, and the value absent from the DOM. Getting there required fixing the test environment, not the plugin: without a fontconfig configuration Chromium registers no fonts, so text renders invisible and typing inserts nothing anywhere (a plainly injected focused `<input>` behaves identically, and `generative-ui`'s pre-existing browser suite was red for the same reason). With `FONTCONFIG_FILE` pointing at a config that lists the store font directories, `e2e/secret-request.e2e.mjs` passes 6 of 6 and the `generative-ui` suite passes fully; see `docs/known-issues/0001-e2e-browser-needs-fontconfig.md` for the fix and its evidence.

Known gap: the 15-minute timer itself is not covered end to end — the suite asserts the returned deadline and exercises the same deletion through `secret_release`, cancel, archive, reload and start, but does not wait for expiry. Both gaps are stated in the plugin README rather than papered over.

## UI

`design/plugin-secret-input-request/ui-spec.md` is the card specification from the UI-design agent, rewritten once for this design and needing one more pass for the corrections in this section.

- State set: `pending` (with its input-hint substates), `sending`, `delivered`, `canceled`, plus the client-derived `gone` (plugin reloaded, server no longer knows the request) and the `offline` / `rpcError` / `unavailable` overlays. `stored`, `revoked`, replace warnings and `expired` are gone — requests never expire; only the handoff file does, and `delivered` carries its live countdown.
- Copy: the value is passed to the agent as a file it can read and is never shown to the agent; nothing says stored, saved or deletable, and no string mentions environment variables. The card states that the value is memory-only and counts down to automatic deletion.
- Title comes from `label`, free text; no variable-name styling, no name-collision warning.
- The field is a masked single line: interior spaces are allowed with a hint, and newlines cannot exist in it at all because the web input strips them. `expectedLength` produces warnings only, and a stripped PEM usually surfaces as "shorter than expected".
- A Cancel button is required; the input is masked, has no reveal affordance, is never rendered in terminal states, and its buffer is cleared on submit, cancel, unmount and whenever the status read shows a terminal state.
