# secret-request: a second instance's sweep deletes a live daemon's handoff directory

Status: root-caused and reproduced. Fix proposed, not applied. The live host's handover is still pointed at a directory any `pnpm test:e2e` run can delete again.

## Symptom

`request_secret` blocked, then every attempt failed with

```
Secret handover is unavailable on this host, so no card was shown: The value could not be handed over:
ENOENT: no such file or directory, open '/dev/shm/paseo-992-secret-request/aa175d78-21ab-4ae5-afb0-3ba6edb4b561/<fresh uuid>'
```

in a real agent session on this host, 2026-10-15 15:58–16:12 (+08:00). The directory component was byte-identical in every message, it did not exist, the file uuid differed per call, and `/dev/shm` was a writable tmpfs. The directory reappeared at 16:10:37.025 +08:00, two seconds after a restarted daemon worker logged `[paseo] Plugin ready` for `secret-request` (pid 281018, `Plugin ready` at 08:10:37.021Z), and handovers worked again immediately afterwards.

The incident report also claimed that no card was ever shown. The session's own transcript contradicts that, and the plugin's own error text is what claims it:

- Four calls returned `MCP error -32001: Request timed out` at 60.0 s each (07:58:22.901→07:59:22.904, 07:59:27.042→08:00:27.044, 08:00:39.191→08:01:39.201, 08:01:55.111→08:02:55.114). A blocked call can only time out while a card is unanswered; the user then wrote `再发一次。我忘了` ("send it again, I forgot").
- `The value could not be handed over` is produced in exactly one place, `requests.ts:336`, inside `submit` — the path the card's **Send** button drives. So each of the four `ENOENT` results (08:04:00.550, 08:04:46.146, 08:04:58.314, 08:07:34.206) is a submit result delivered to the call that was attached to that entry. The first one landed 4.6 s after the fifth call, because the user answered the card of the _first_ request, which was still pending and which the fifth call had attached to.
- After the restart recreated the directory, the next four calls returned `delivered` (08:17:03.873, 08:17:46.800, 08:18:28.604, 08:19:48.242) and the agent reported "all three cards arrived".

`mcp.ts:134` prefixes `so no card was shown` to **every** `unavailable` status, including the post-submit one, which is what made a delivery failure read as a rendering failure.

## Root cause

`sweepExpired` cannot tell a dead earlier daemon lifetime from a live peer instance, and it deletes the peer's directory.

`handoff.ts:97` `sweepScope` removes every file older than `HANDOFF_TTL_MS` (15 min) and then removes the directory itself when the _directory's own_ mtime is that old:

```ts
if (now - before.mtimeMs >= HANDOFF_TTL_MS) await rmdir(directory)...
```

`handoff.ts:121` `sweepExpired` applies that to every directory in `/dev/shm/paseo-<uid>-secret-request/` except the caller's own scope, which it skips by name. Directory mtime tracks the last file added or removed inside it, so a live instance whose scope has had no delivery for 15 minutes — the ordinary steady state between secrets — has a directory indistinguishable from a dead lifetime's, and it is removed. The peer's own start (`requests.ts:79` `prepare` → `prepareHandoff` → `await this.sweep(scope)`) and its 60 s interval both do this.

Nothing re-creates the directory afterwards:

- `requests.ts:79` memoizes the result of `prepareHandoff` for the lifetime of the plugin (`this.handoff ??= ...`), so `handoff.root` stays `/dev/shm/paseo-<uid>-secret-request/aa175d78-...` for the whole run, and the directory is created (mkdir) only inside `prepareHandoff` (`handoff.ts:46`).
- `handoff.ts:142` `writeValue` only opens the file inside that root (`open(join(root, requestId), "wx", 0o600)`), so the first delivery after the deletion fails `ENOENT` and `submit` returns `unavailable` (`requests.ts:301`–`336`); the entry is then forgotten and every later call repeats it with a fresh request id in the same missing directory.

The live instance's directory name comes from `PASEO_HOME/plugin-data/secret-request/state.json`, written on the first `change()` and stable across restarts (`storage.ts:15,42`, `index.server.ts:14`); the failing host's file reads `{"version":1,"port":45465,"handoffId":"aa175d78-21ab-4ae5-afb0-3ba6edb4b561",...}`.

## Why a peer instance exists on this host

`e2e/support/runtime.mjs:176` isolates `PASEO_HOME`, `HOME`, `XDG_*` and `CODEX_HOME` for every E2E daemon, but nothing isolates `/dev/shm`: `secret-request.e2e.mjs:202` deliberately asserts its handoff path sits under the shared `/dev/shm/paseo-<uid>-secret-request/`, and `secret-request.e2e.mjs:593` plants test directories directly in that shared base. Every E2E daemon therefore starts a `secret-request` plugin that sweeps the production daemon's scope with the rule above. The fixture is not the defect — the sweep rule is — but AGENTS.md mandates `pnpm test:e2e` as the only behavior test, so the fixture is what fires it on this host.

## Evidence

Live, in the failing window:

- Six scope directories appeared under `/dev/shm/paseo-992-secret-request/` at 16:04:06, 16:04:28, 16:05:38, 16:05:58, 16:06:51 and 16:07:24 (+08:00), all with names other than the persisted `aa175d78`, all empty except `3c59bc02-...` (one 53-byte file). The live daemon logged no plugin load in that window: the only `secret-request` loads in `daemon.log` are 2026-10-14T12:29:46Z (worker pid 1206) and 2026-10-15T08:10:35Z (worker pid 281018).
- Those same six directories were themselves removed later by another instance's sweep: seven directories were present at 16:22, four of them gone by 16:25 (base directory mtime 16:22:37). That is the rule running on this host, on a directory that is minutes old rather than dead.
- `aa175d78...` was absent before the first failed submit (08:04:00Z) and still absent at 08:07:34Z, across a session reload, and came back only at the plugin start at 08:10:37Z.
- The live daemon has been sweeping foreign scopes for a while: `swept 1 expired handoff file(s) left by earlier daemon lifetimes` at 07:14:54Z, 07:19:54Z, 07:26:54Z and 07:43:54Z.
- The live scope currently holds four handoff files (16:17:08–16:19:51 +08:00) — the session's own AWS and GitHub credentials. I did not read them.

Reproduced with two real daemons (throwaway `node --test` script driving `e2e/support/runtime.mjs`, not committed):

1. `const live = await runtime(t, { tools: [] }); await live.install("secret-request"); const agent = await live.createAgent(live.temporary, "Live handover");`
2. Read `join(live.home, "plugin-data", "secret-request", "state.json")` for `handoffId`, assert `/dev/shm/paseo-<uid>-secret-request/<handoffId>` exists, then `utimes` that directory to `Date.now() - HANDOFF_TTL_MS - 60000` — the live instance now looks like a directory left by a lifetime that ended 16 minutes ago, while `live` is running.
3. Start a second instance (`const peer = await runtime(t, { tools: [] }); await peer.install("secret-request"); await peer.client.reloadPlugin("secret-request");`) and wait for the live directory to disappear.
4. Open the live daemon's MCP transport, call `request_secret` (it blocks and publishes its card as usual), then submit through `live.rpc("secret-request", "secret-request.submit", ...)` with the request id from the published item.
5. Assert `result.status === "unavailable"`, `result.path === null`, `result.message` equal to the `ENOENT` string for `join(liveRoot, requestId)`, and that the blocked MCP call returns that message prefixed with `Secret handover is unavailable on this host, so no card was shown: `. Both assertions passed; the complete output was:

```
live instance root: /dev/shm/paseo-992-secret-request/d267a13b-459a-4a0d-a0fc-7ffc402d4443
aged the live instance's own directory to simulate 15 minutes without a handoff file,
which is the idle steady state of a daemon between secrets
peer instance removed /dev/shm/paseo-992-secret-request/d267a13b-... while the live instance was still running
peer daemon log mentions the removal: false
submit result: {"status":"unavailable",...,"message":"The value could not be handed over: ENOENT: no such
file or directory, open '/dev/shm/paseo-992-secret-request/d267a13b-.../3d0f5f97-28b6-4e6d-bd3b-60a7388a88eb'"}
agent saw: Secret handover is unavailable on this host, so no card was shown: The value could not be handed over: ...
```

Both assertions in the script were equality checks against the incident's strings, so the peer deletion reproduces the reported text byte for byte. The removal is logged nowhere: `sweepScope` counts only files, so a directory deleted under a live daemon leaves no trace in either daemon's log.

## Ruled out

- **A cached request id reused across calls and labels.** `requests.ts:243` builds `requestId: randomUUID()` per request; only the _directory_ is reused, and that is by design (one directory per daemon lifetime). The transcript's four failing calls carry four distinct ids inside one directory.
- **A path built in another mount namespace.** Both daemons resolve the same `/dev/shm/paseo-992-secret-request`; the E2E scenario at `secret-request.e2e.mjs:538` shows the plugin _refuses_ when `/dev/shm` is not tmpfs instead of writing elsewhere, and `handoff.ts:46` re-checks `TMPFS_MAGIC` on the resolved root.
- **A write/read ordering in which the directory disappears before the reader opens the value file.** The `ENOENT` is thrown by `open(join(root, requestId), "wx")` in `writeValue`, before the file exists; there is no reader yet, and between a successful write and the reader nothing unlinks it — TTL, archive and cancel deletion all run after delivery.
- **A per-request subdirectory renamed or unlinked at handover.** There is no per-request directory; the value file is created directly in the scope directory, and cancel removes nothing.
- **"Each call creates a new empty directory."** No code path creates a directory per call: `prepareHandoff` runs once per plugin start (`requests.ts:79`) and `writeValue` only opens a file. The fresh directories belong to other instances, as the plugin-start timestamps in `daemon.log` show.
- **The 16:10:12 daemon restart as the cause.** The failures predate it by six minutes, and the restart _masked_ them by re-running `prepareHandoff`, which re-created the missing directory. The plugin keeps no handover state that survives a restart: `Requests.entries` is in memory only, `state.json` holds `{version, port, handoffId, sessions}` (no values, no per-request records), and `/var/lib/paseo/.paseo/agent-requests/*.json` is the daemon's own request queue (`{fingerprint, agentId, state}`), not plugin state.

## Proposed fix

1. Make the directory rule mean what it says. The owner should refresh its own scope directory's mtime on the existing 60 s sweep tick (`utimes(root, now, now)` in `requests.ts:100` `sweep`), so a peer only ever removes a directory that has been idle past the deadline _because its owner stopped_. `sweepScope` then stays as it is.
2. Also make the writer self-healing, so any future loss of the directory costs nothing: re-run `privateDirectory` (and the `statfs` check) on `handoff.root` before the `open` in `writeValue`, or at the top of `requests.ts:243` `request`, and re-create it if it is gone. The `0600`/uid checks on the value file stay.
3. Stop the E2E suite from touching a live daemon's base: run its daemon with a private `/dev/shm` (`unshare -m` plus a tmpfs, the machinery `secret-request.e2e.mjs:542` already uses for one scenario) and have the planted-directory scenario clean up after itself. This is hygiene, not the root cause: two instances on one host remain legal, and the plugin's README claims they never delete each other's live handoffs.
4. Log directory removals (`sweepScope` should report them the way it reports files) so this failure is visible next time.
5. Reword `mcp.ts:134`: `so no card was shown` is wrong when the message came from a submit failure, and it sent this investigation after a card-rendering bug that does not exist.

Verification for the fix: an E2E scenario starting a second daemon next to a live one, ageing the live daemon's scope directory past the deadline, then asserting the peer's start leaves it alone _and_ that a submit through the live daemon still returns `delivered` — with the existing `an expired handoff left by an earlier lifetime is swept while a live one is kept` scenario kept green for a genuinely dead lifetime.

## Unverified

- Which run deleted the live directory. The removal is silent and peer daemons' logs live in temp homes that `runtime.mjs` deletes at teardown. The attribution to the E2E suite is circumstantial: six fresh instance directories against two plugin starts in `daemon.log`, sibling worktrees with installed dependencies and live harness leftovers (`/tmp/paseo-plugin-e2e-*`, `/tmp/capture-activity.mjs`), and the repo's own rule that the suite is the only behavior test.
- When it was first deleted: anywhere between the owning worker's start (2026-10-14T12:29:46Z) and the first failed submit (2026-10-15T08:04:00Z).
- How the user answered four cards within 1–5 s of each call (08:04:00, 08:04:46, 08:04:58, 08:07:34). That the submits happened follows from the plugin source; the client-side input behaviour that made them fast is outside this repository and was not inspected.
- The four handoff files still in the live scope were not read, and the live host was not restarted or reconfigured. The directory becomes deletable again roughly 15 minutes after the last handoff file expires (about 16:50 +08:00 on 2026-10-15), so the next `pnpm test:e2e` run on this host can break the next handover again.

## Related

- `plugins/secret-request/server/handoff.ts`, `server/requests.ts`, `server/storage.ts`, `server/mcp.ts`.
- `plugins/secret-request/README.md` — "The per-daemon `handoffId` scopes the startup purge, so two daemons on one host never delete each other's live handoffs" is the invariant that fails.
- `design/plugin-secret-input-request/design.md` — `/dev/shm/paseo-<uid>-secret-request/<handoffId>` is described as one directory per daemon lifetime, and the sweep as a rule over "earlier daemon lifetimes".
- `docs/known-issues/0001-e2e-browser-needs-fontconfig.md` — the other test-environment defect in this suite.
