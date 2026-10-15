# secret-request — design and evidence

Status: implemented (`plugins/secret-request`), shipped in commit `511d4a5`. This document holds the decisions and the evidence behind them. Operation and limits live in the [plugin README](../../plugins/secret-request/README.md), the card contract in [ui-spec.md](./ui-spec.md), the decisions in [`docs/adr/`](../../docs/adr), and the test-environment defect behind the browser suite in [`docs/known-issues/0001-e2e-browser-needs-fontconfig.md`](../../docs/known-issues/0001-e2e-browser-needs-fontconfig.md).

Scope is a single gesture: an agent asks the user for one secret, the user types it into a card in the conversation, the agent uses it, nothing is kept — no vault, no settings screen, no grants, no reuse across sessions.

## Invariants

- **I1 — the value is never chat history.** Not a `user_message`, not an `assistant_message`, not an MCP tool argument, not an MCP tool result, not a plugin timeline item's `data`, not an RPC error, not a log line.
- **I2 — the value must be usable in the same turn.** The tool call blocks until the user answers, so the agent gets a usable handle without ending its turn.
- **I3 — the value is transient and never touches persistent storage.** It lives in daemon memory and in one RAM-backed file under `/dev/shm`, deleted on TTL expiry, on agent archive, and when the plugin starts (a reload is a restart). If the host cannot provide a RAM-backed handoff, the request fails before the card appears rather than falling back to disk. Nothing about the value's shape is part of the contract: a declared expected length was removed because it is a guessable property of the secret.

## Why blocking forces a file handoff

Environment-variable injection cannot be part of a blocking answer in 0.11.2:

- `env` is fixed when the provider process starts. The only way a plugin changes it is the `agent.session_open` hook, and that hook runs on `create` / `resume` / `refresh` / `import` — never mid-turn.
- Forcing a re-open means daemon-client `refreshAgent`, which first calls `interruptAgentIfRunning` → `cancelAgentRun` (`session.js:868+`, `session.js:3344-3357`). The turn that is waiting on the tool call is canceled, the MCP connection dies, and the pending tool result is lost.

So a blocking request must deliver something the running turn can consume immediately: a path to a file whose contents are the secret. That is the entire reason for the handoff file — not a convenience, but the only channel that survives the turn boundary. The value itself never travels the answer path, unlike Paseo's own question flow where the answer becomes the tool result and therefore history.

## Flow

1. Agent calls `request_secret({label, description?, hint?})`, which blocks. The plugin never expires a request; a provider or agent runtime may still time out or cancel the tool call.
2. The plugin creates a request, appends a metadata-only plugin timeline item, and waits. One request per agent is live at a time, so a retry resumes that wait instead of stacking a second card, and a call the client cancels — a provider-side timeout rejects with `-32001` first — leaves the delivery uncollected rather than lost: the next call under the same label hands the path over until its deadline expires. The first caller that receives a path consumes it, and its label starts a new request after that (ADR 0007).
3. The client renders the card (see `ui-spec.md`); submit and cancel travel plugin RPC, never a message.
4. On submit the value is written once to the handoff file and the blocked call returns `{status:"delivered", requestId, label, path, handoffExpiresAt}`.
5. Cancel resolves the call with `{status:"canceled"}` so the agent learns the user declined instead of waiting.

Deletion triggers, file permissions, refusal behaviour and the exact path are in the README; the channel decision is ADR 0004, the no-vault decision ADR 0005, the newline decision ADR 0006, the delivery-recovery decision ADR 0007.

## Verified constraints in 0.11.2 (daemon read, call chains cited)

Re-verified after `main` upgraded this checkout from 0.10.2 to 0.11.2; line numbers are 0.11.2, and the semantic changes the upgrade brought are noted where they matter.

- Timeline is one-way: history flows provider → Paseo (`hydrateTimelineFromProvider`, `agent-manager.js:2148`), the only mapping is forward (`plugin-provider.js:1368-1376`), and plugin items are skipped by the activity curator (`activity-curator.js:74-78`; its curation switch has no plugin case). I1 holds against the timeline.
- A blocked tool call cannot deadlock the card. The MCP server runs inside the plugin child on its own loopback HTTP listener, while `secrets.submit` travels daemon → plugin as a `requestId`-keyed IPC request dispatched concurrently (`plugins/plugin-process.js:495` registers a plain `process.on("message")` handler that never awaits its predecessor) under a 30 s per-request `REQUEST_TIMEOUT_MS` (`plugins/runtime.js:18`, applied at `:404-428`). The submit handler is a file write, so that timeout is headroom.
- The MCP listener binds at plugin start, and the Paseo API is attached on any contact (agent create, session open, turn start, or a client RPC), because after a plugin reload a live agent can call the tool before the next hook fires; an unattached call answers with a retry hint instead of failing on a dead port.
- The append path is not gated on an idle agent (`agent-manager.js:1566`), so the card can appear while the tool call is blocked. An unloaded agent rejects the append (`requireAgent`, `agent-manager.js:3785-3797`) — the state right after a daemon restart — until something loads that agent from disk; the timeline fetch does (`session.js:5780`) and the plugin append path does not (`session.js:5873-5881`). `publish` therefore retries the append for about three seconds, which the restart scenario exercises.
- A plugin-created timeline item is persisted in the daemon timeline store (`recordTimeline`, `agent-manager.js:3398-3401`) and survives reloads; after `rehydrateFromDisk` (`agent-manager.js:879-882`) the in-memory timeline is wiped, so items must be re-appended from plugin state. Plugin timeline data is capped at 64 KiB (`agent-timeline-content.js:2-6`), which the request metadata never approaches.
- The daemon redacts nothing but HTTP auth headers (`logger.js:19-27`); plugin stdout/stderr is captured verbatim (`plugins/runtime.js:26-35`) and timeline items are persisted as written. The plugin is the entire redaction layer, so the value must never enter a log call.
- `agent.session_open` env does reach the provider process (`agent-manager.js:3710` → `plugins/lifecycle/index.js:25,104` → `paseo-env.js:14`) and runs on `refresh`, but a refresh first interrupts the running turn (`interruptAgentIfRunning` → `cancelAgentRun`, `session.js:878-896`; the refresh path is `session.js:3364-3368`). That is what rules env injection out here.
- Tool preapproval is gated on the provider contract flag `supportsExactMcpPreapproval`, not on `applyToolPolicy`: `provider-registry.js:388-399` raises `ToolPolicyUnsupportedError` when a provider lacks it, and plugin providers advertise it (`plugin-provider.js:713`).
- A provider-side MCP timeout is observable, and it is the only signal that a blocked call is gone: the SDK client's timeout path rejects with `McpError(ErrorCode.RequestTimeout, "Request timed out")` and, before rejecting, sends `notifications/cancelled` with the request id (`shared/protocol.js:669-713` in `@modelcontextprotocol/sdk` 1.31.0). The gateway serves every POST with its own stateless `McpServer`, so that notification arrives at a fresh instance that knows nothing about the blocked request — the plugin keeps the JSON-RPC id of each in-flight `tools/call` itself and aborts that call's controller on the notification, or when the response closes first. The SDK writes the blocked call's response to the abandoned request without error (`_onresponse`, `:449-468`, reports an unknown id only through `onerror`), which is why a delivery could previously vanish with the file on disk.
- `/dev/shm/paseo-<uid>-secret-request/<handoffId>` is one directory per daemon lifetime, and the startup purge only reaches the current one; a lifetime that ends before its deadline expires used to leave its files for good. Their mtime is the delivery time — `writeValue` creates the file once with `open(..., "wx")` — so a file older than the deadline is expired whichever lifetime wrote it, which is the rule the sweep applies to every other scope at start and once a minute. A directory is not a file: idle time alone cannot tell a scope a finished lifetime left behind from a live instance's scope that simply had no delivery for a while, so the same tick also revalidates and touches the plugin's own directory, and a foreign directory is removed only once it has been idle past the deadline — with that heartbeat, the owner has stopped. A directory that disappears regardless is recreated by the next submit before the value is written. `docs/known-issues/0002-secret-request-sweep-deletes-live-handoff-dir.md` has the failure this corrects.

## Mirrors Paseo's native ask flow

Paseo already solves "block an agent until the user answers" for its own question tools, and this design copies its lifecycle: each provider maps its ask tool into `AgentPermissionRequest{kind:"question"}` (verified in 0.11.2 at `claude/agent.js:707-708`, and the same shape in the other providers), the client renders it, and the answer returns through the permission-response path. There is still no permission-timeout constant anywhere in the daemon, so an unbounded block matches native behaviour.

What is shared: a pending registry keyed by a stable id resolved by one client call; **no timeout** (there is no permission-timeout constant anywhere in the daemon, which is why the unbounded block reproduces native behaviour); in-memory state that is rebuilt only if the producer replays it (hence the card's `gone` state after a reload); cancel as a first-class answer rather than a dropped request.

What differs, deliberately: the value never travels the answer path; a blocked secret request does not set `requiresAttention` (the plugin SDK exposes it read-only), so the card is the only cue; and the tool is not added to `toolPolicy.preapproved`, because preapproval requires the provider to implement `applyToolPolicy` and the daemon rejects the agent request otherwise (`agent-manager.js:3618-3622`).

## Limits

- The value sits in a RAM-backed tmpfs file for up to 15 minutes, readable by the daemon user and root, and in JavaScript strings that cannot be zeroed. On a host with unencrypted swap, tmpfs pages can be written to swap, so the value can reach disk after all.
- No `/dev/shm`, or a non-tmpfs one, means the feature is unavailable by design: the agent gets a clear error instead of a card.
- No MCP tool can delete the file early, but the agent has a shell: it can read, copy or print the file, so the TTL bounds the exposure window only for an agent that follows its instructions.
- Multi-line secrets are not special-cased (ADR 0006): the web field cannot hold newlines, so a pasted PEM arrives single-line and the agent must repair or re-request it.
- The agent itself can leak the value; the plugin cannot stop that. The injected instruction forbids echoing it and reporting its length, prefix, suffix or hash.
- The label is the recovery key for a call that died under it: a retry that rewords the label beyond a trailing qualifier starts a new request, and the earlier delivery stays uncollected until its deadline deletes it.
- The value crosses the client ↔ daemon transport; a phone or remote client should be on the relay's E2EE path, which the plugin can neither detect nor enforce.
- Agents created before the plugin was installed do not receive the MCP server automatically.

## Verification

`e2e/secret-request.e2e.mjs` runs against an isolated real daemon, the real MCP transport and the real Web UI, per `.agents/skills/paseo-plugin-e2e/SKILL.md`: the single-tool surface, the blocked call, the `0600` tmpfs path, the sentinel appearing in the handoff file and in no timeline, log or `PASEO_HOME` file, delivery and cancel through the browser card with `type="password"` and the value absent from the rendered DOM, idempotent submit, a caller whose MCP client times out before the user answers and then collects the delivery by retrying under a reworded label (asserting the same `requestId` and path, no second card, and that a third call under the label starts a new request), deletion on plugin reload, daemon restart and agent archive, an expired handoff in the scope of an earlier lifetime next to a live one that must survive, a two-daemon scenario where a live instance's directory keeps its mtime advancing with no handover, a second instance's sweep removes an aged sibling while leaving that directory and its handover alone, and a delivery recreates the directory after it is deleted, plus a `mount`-namespace scenario where `/dev/shm` is not tmpfs and the request must be refused. With the font configuration from `docs/known-issues/0001-e2e-browser-needs-fontconfig.md` the suite passes 11 of 11, and the `generative-ui` browser suite passes as well.

Two gaps are stated rather than papered over: the 15-minute timer itself is not waited out (the same deletion is exercised through cancel, archive, reload and start), and the browser suite needs a font configuration the environment does not provide by default. The minute tick is waited out, in the two-daemon scenario that asserts both sides of the rule: the live instance's directory survives another instance's sweep, and an aged sibling does not.
