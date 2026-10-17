# Design: paseo-obsidian

Issue: none — planning branch. Grill: `docs/design/_intake/paseo-obsidian-grill.md` @ 2026-10-13. Scaffold: none.
Target: Paseo **0.11.2** — the daemon on the development machine, with the workspace CLI, client, and plugin SDK pinned to the same version.
Glossary: `GLOSSARY.md` (+10 terms). ADRs: `docs/adr/0001-headless-sync-through-the-official-cli.md`, `0002-read-only-binds-tools-and-sync-direction.md`, `0003-one-global-vault.md`. UI: `docs/design/paseo-obsidian-ui.md`.
Method: mattpocock/skills (grill-with-docs, domain-modeling). Approval: pending — rounds 1–6 settled, slice plan and budget await confirmation.

## 1. Problem and done

- **Done predicate:** With the plugin installed on a daemon that has `obsidian-headless` on `PATH` (or a configured path), and with a pasted account token plus one selected remote vault, one supervised `ob sync --continuous` process keeps `$PASEO_HOME/plugin-data/obsidian/vault` in `pull-only` sync. Every agent created on the daemon receives an `obsidian` MCP server exposing read-only `list_vault`, `glob_vault`, `grep_vault`, and `read_vault` over that vault, plus the vault's `.paseo/system.md` appended to its system prompt and one front-matter index line per `.paseo/skills/*.md`, whose bodies it reads on demand. The composer's attachment picker searches notes and inserts a vault-relative path plus a content snapshot capped at 8 KB. A global "Obsidian vault" screen with a sidebar item shows sync state, last successful sync, vault identity, and injection status; a settings screen holds the token, the vault choice, and the `ob` path. No tool writes, and the client never uploads local changes.
- **Non-goals / out of boundary:** Write tools, push, and the read-only↔read-write switch (slice B, §7); semantic search over tags, frontmatter, and the link graph; `[[wikilink]]` and title resolution; Obsidian Publish; slash commands; command-centre items; per-workspace vault binding; multiple simultaneous vaults; filesystem-level enforcement of read-only; syncing `.obsidian/` configuration; operating-system notifications; filesystem watching of the managed directory.
- **Constraints found while grounding:**
  - `obsidian-headless@0.0.14` is `license: UNLICENSED`, published by Dynalist Inc., requires Node ≥ 22, ships the `ob` binary (`cli.js`) with `better-sqlite3` and `commander`. The plugin must never bundle or fetch it; it is a documented host prerequisite.
  - Authentication accepts `OBSIDIAN_AUTH_TOKEN` in the environment, overriding `<config>/auth_token`. On Linux the CLI config directory is `$XDG_CONFIG_HOME/obsidian-headless`, otherwise `~/.config/obsidian-headless`; the CLI writes `auth_token` with mode 0600 and creates the directory with 0700.
  - `ob sync-config` sets `--mode bidirectional|pull-only|mirror-remote`, `--conflict-strategy merge|conflict`, `--file-types`, `--configs`, `--excluded-folders`, `--config-dir` (default `.obsidian`). `ob sync-setup --vault <id-or-name> --path <dir>` registers a vault. `ob sync --path <dir> --continuous` keeps a live connection, reconnects after disconnect, and retries. The CLI keeps a lock at `<config-dir>/.sync.lock` inside the vault and refuses to start a second sync for it. `sync-list-remote`, `sync-list-local`, `sync-status`, and `sync-config` accept `--json`; errors go to stderr with a non-zero exit. `sync-status --json` reports configuration only — `vaultId`, `vaultName`, `vaultPath`, `syncMode`, `conflictStrategy`, `deviceName`, `configDir`, `fileTypes`, `configs`, `excludedFolders` — and carries no last-sync timestamp. Observed exit codes: 3 when the path has no sync configuration, 2 when the E2EE key is missing, 1 otherwise.
  - Paseo 0.11.2 has no `$`-mention feature and no mention extension point; the only composer picker a plugin can add is an attachment source (`addAttachmentSource` + a `search` RPC the host calls with `{ query }` and parses with `PluginAttachmentSearchPayload`). The host's own `@` autocomplete covers workspace files only and is not extensible.
  - Paseo 0.11.2 has no plugin skill registry: the SDK exports nothing skill-related, and Paseo's own skills come from directories each provider scans (`$CODEX_HOME/skills`, `<cwd>/.codex/skills` for Codex; `~/.agents/skills`, `<cwd>/.agents/skills` for the omp and Claude families), where only `SKILL.md` front matter reaches the prompt. A plugin therefore delivers skill text either by appending to `config.systemPrompt` in `server.before("agent.create", ...)` (the `devenv` pattern) or by writing files into a provider-scanned directory, which writes outside plugin data. MCP servers are contributed through `config.mcpServers`; tool preapproval is `config.toolPolicy.preapproved`.
  - `@getpaseo/plugin/server` exports `spawnProcess`, `execCommand`, and `terminateProcess` in 0.11, so the `ob` process is supervised with the host's helpers instead of raw `child_process`.
  - UI registers with `addScreen({ id, title, Component })` and `addSidebarHeaderItem({ id, title, Component })`. The item renders its own `SidebarRow`. `addSurface`, `addSidebarItem`, and `openSurface` are deprecated aliases that the repository lint rejects. A manifest may carry `name` and `icon` from 0.11.0, which is what this plugin's `requirements.paseo` targets.
  - There is no secrets API; settings are host-scoped JSON documents that the docs call "not a credential vault". Credentials therefore live in a plugin-owned 0600 file.
  - `plugins/generative-ui` is the in-repo precedent for plugin-provided MCP tools: a loopback HTTP gateway (`@modelcontextprotocol/sdk`, `McpServer` + streamable HTTP on `127.0.0.1:0`), a per-agent bearer token minted in `before("agent.create")`, host-header and origin checks, POST only, 128 KB body cap.
  - Client and server run in separate runtimes: spawned processes, files, and the token live in `server/`; the client reaches them only through Zod RPC contracts in `shared/`.
  - Repository rules: no source comments, exhaustive switches, no unsafe assertions, no floating promises, real isolated-daemon E2E only, no unit tests, no mocked host, provider, or transport.

## 2. Usage (caller's view, written first)

The server entry builds one deep module and returns its cleanup:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { installVault } from "./server/install";

export default function contribute(server: PluginServerContext) {
  return installVault(server, {
    dataRoot: process.env.PASEO_HOME
      ? `${process.env.PASEO_HOME}/plugin-data/obsidian`
      : undefined,
    defaultObBinary: "ob",
  });
}
```

The client registers a global screen, its sidebar item, a settings screen, and the composer picker:

```tsx
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({
      id: "vault",
      title: "Obsidian vault",
      Component: VaultScreen,
    }),
    client.addSidebarHeaderItem({
      id: "vault",
      title: "Obsidian vault",
      Component: VaultSidebarItem,
    }),
    client.addSettingsScreen({
      id: "obsidian",
      title: "Obsidian vault",
      icon: "Settings",
      Component: VaultSettings,
    }),
    client.addAttachmentSource(
      defineAttachmentSource({
        id: "vault",
        title: "Obsidian",
        icon: "Notebook",
        pickerTitle: "Reference a note",
        searchPlaceholder: "Search notes",
        search: searchRpc,
      }),
    ),
  ];
  return async () => {
    for (const cleanup of cleanups) await cleanup();
  };
}
```

Non-secret setup lives in the host settings document (`obPath`, `vaultId`, `vaultName`), and the token deliberately does not, because `SettingsState.values` is returned to the client. Everything else is one RPC against the shared contracts:

```ts
const status = await rpc(statusRpc, {}); // screen, banners, tool freshness
const remotes = await rpc(remotesRpc, {}); // ob sync-list-remote --json
await rpc(tokenSetRpc, { token: pasted }); // validated against the CLI, stored 0600
await rpc(syncNowRpc, {}); // one-shot pull; the watcher restarts after it
const listing = await rpc(listRpc, { path: "" }); // vault browser folder
const note = await rpc(readRpc, { path: "Inbox/A.md" }); // vault browser note
const results = await rpc(searchRpc, { query: "weekly" }); // composer picker
```

The RPC surface, all defined in `shared/contracts.ts`, with the full shapes in the UI design's implementation mapping:

| Contract        | Input       | Output                                                                                                                    |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `statusRpc`     | `{}`        | `VaultStatus`: sync state, `ob` probe, token presence, vault, injection status                                            |
| `tokenSetRpc`   | `{ token }` | `saved` with an account label, `rejected`, or an error carrying a sync code                                               |
| `tokenClearRpc` | `{}`        | `removed`; the stored copy is deleted                                                                                     |
| `remotesRpc`    | `{}`        | `ok` with remote vaults, `token_missing`, or an error carrying a sync code                                                |
| `syncNowRpc`    | `{}`        | `started`, `already_pulling`, or `unconfigured`                                                                           |
| `listRpc`       | `{ path }`  | entries with `truncated`, or an error: `path_denied`, `not_found`, `vault_unavailable`                                    |
| `readRpc`       | `{ path }`  | text with `truncated`, `bytes`, `modifiedAt`, or an error: `path_denied`, `binary_file`, `not_found`, `vault_unavailable` |
| `searchRpc`     | `{ query }` | `PluginAttachmentSearchPayload`; an unready vault returns no items rather than an error                                   |

`VaultStatus.sync.state` is one of `unconfigured`, `starting`, `watching`, `stale`, `error`, carrying `token`, `ob`, `vault`, `lastSuccessAt`, `staleAfterSeconds`, and on `error` a `code` — `ob_missing`, `ob_too_old`, `token_invalid`, `vault_missing`, `remote_unreachable`, `lock_held`, or `sync_failed` — with the repair action the screen should offer.

Agents see only tools and prompt text:

- MCP server `obsidian` (HTTP, loopback, bearer token per agent) with `list_vault`, `glob_vault`, `grep_vault`, `read_vault`. Every result carries `lastSyncedAt` and `stale: boolean`.
- A prompt block appended after the host's own `systemPrompt`: the plugin's short instructions, then `.paseo/system.md`, then one index line per `.paseo/skills/*.md` — name, description, and vault-relative path — in file-name order. Skill bodies stay in the vault and are read on demand with `read_vault`. No vault path is injected into the environment.

The four tools, and the picker, are specified so slices S3 and S4 have exact contracts:

| Tool         | Input                                                                                           | Output                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `list_vault` | `{ path?: string, depth?: number }`                                                             | `{ entries: { path, name, type, size, modifiedAt }[], truncated }`                              |
| `glob_vault` | `{ pattern: string, limit?: number }`                                                           | `{ paths: string[], truncated }`                                                                |
| `grep_vault` | `{ query: string, regex?: boolean, caseSensitive?: boolean, include?: string, limit?: number }` | `{ matches: { path, line, text }[], truncated }`                                                |
| `read_vault` | `{ path: string, offset?: number, limit?: number }`                                             | `{ path, text, truncated, bytes, modifiedAt }` or `{ error: "binary_file", bytes, modifiedAt }` |

Every tool result additionally carries `{ vault: { name }, lastSyncedAt, stale }`. Fixed limits: 1,000 entries for `list_vault`, 200 paths for `glob_vault`, 100 matches or 200 KB for `grep_vault`, 256 KB per `read_vault` call. `grep_vault` skips files whose first 8 KB contains a NUL byte, so images, PDFs, and other attachments never enter the text path. Paths are vault-relative, are resolved through the jail in `server/vault.ts`, and any escape, symlink out of the vault, or entry under `.obsidian/`, `.trash/`, or `Trash/` returns a `path_denied` error instead of an empty result. Both trash spellings are denied because the plugin does not sync `.obsidian/` and therefore cannot read the vault's configured trash folder name.

The picker's `searchRpc` matches case-insensitively on path substring and note name (`id` and `identifier` are the vault-relative path, `title` the note name, `subtitle` the parent folder, `url` an `obsidian://open?vault=<name>&file=<path>` link), returns at most 50 items ordered by note name, and puts `<path>` followed by a content snapshot of at most 8 KB into `text`, ending with a truncation marker when the note is longer. An empty query returns the first 50 notes by name, and an unready vault returns no items rather than an error, because the host propagates a rejected search with no declared rendering. The picked `url` is validated by the SDK's `z.url()`; `obsidian://` was confirmed to pass that validator with the workspace's zod 4.6.5, so the shared scheme works even though `openExternalUrl` itself is HTTP(S)-only.

## 3. Strategy

- **Chosen shape:** `installVault(server, options): PluginCleanup` is the only server interface. It synchronously registers RPC handlers and the `agent.create` before-hook, then owns one private initialization promise, the credential file, `ob` discovery and verification, vault registration, watcher supervision with backoff, status derivation, the vault reader, the injection reader, and the MCP gateway; it returns cleanup that stops the watcher, closes the gateway, and removes listeners. **Interface depth:** callers cannot bypass credential validation, pull-only configuration, single-instance enforcement, or cleanup. **Seams:** the RPC contracts in `shared/contracts.ts` separate client transport from the server module, and the `ob` invocation point takes the binary path and environment so the daemon host and E2E can point it at a real binary.
- **Alternatives (design it twice):**
  - Inline everything in `index.server.ts` with module-level state — least ceremony, rejected because credential handling, watcher lifecycle, and the gateway would share one file and cleanup would be hard to prove.
  - Export a `Vault` service class with methods per operation and let the entry orchestrate — explicit and testable, rejected because it duplicates the RPC-shaped surface and lets the entry skip initialization ordering.
  - Install-only deep module — chosen, matching the `devenv` and `paseo-nstack` precedent in this repository.
- **Sync transport and configuration:** spawn the official CLI rather than reimplementing or depending on a reverse-engineered client. The remote vault is chosen in settings from `remotesRpc`; on a settings change the server runs `ob sync-setup --vault <id> --path <managed>`, then `ob sync-config --mode pull-only --configs ""`, then starts the watcher. `pull-only` is what makes the client itself ignore local changes; `--configs ""` keeps `.obsidian/` out of the managed directory; `--conflict-strategy merge` stays at the default.
- **Isolation:** child processes get `OBSIDIAN_AUTH_TOKEN` from the plugin's own 0600 file and `XDG_CONFIG_HOME` pointed at the plugin data root (with `HOME` untouched), so the CLI's own credential and state files never conflict with a user's separate `ob` login, and the shipped `auth_token` file stays inside plugin data.
- **Watcher supervision:** one process at a time, started and stopped with `spawnProcess` and `terminateProcess` from `@getpaseo/plugin/server`, guarded by an in-process flag and the CLI's `<config-dir>/.sync.lock`; on unexpected exit, restart with exponential backoff (1s, 2s, 4s… capped at 60s), reporting `starting` while reconnecting and `error` with the last stderr line only after repeated failures. Reconnection inside a live process is delegated to the client. Because `sync-status --json` carries no timestamp, `lastSuccessAt` is the plugin's own record: the time of the last successful sync completion it observed, refreshed from the watcher's progress output and from a completed one-shot `ob sync`. A successful sync older than the 15-minute `staleAfterSeconds` window marks results `stale`, and a failure to complete any sync within that window surfaces as `stale` rather than `error` as long as the process is alive.
- **Freshness and failure:** tools never block. Unconfigured, invalid token, unreachable remote, and missing vault return structured errors; stale data returns content plus the staleness marker. The panel offers the matching repair action for each code.
- **MCP tools:** follow the `generative-ui` gateway pattern — one loopback HTTP MCP server in the plugin process, per-agent bearer token minted in `before("agent.create")`, `Host`/`Origin` checks, POST-only, request cap. Read handlers resolve every path through one jail function (`realpath` containment check plus a `.obsidian/` and `Trash/` deny list) and never expose binary content, only path, size, and mtime.
- **Injection:** `.paseo/system.md` is appended in full, capped at 32 KB with a truncation marker. Each `.paseo/skills/*.md` contributes only an index line — name, description, and vault-relative path from its front matter, in file-name order — while the body stays in the vault for the agent to read with `read_vault`; that mirrors how Paseo's own providers surface skills (front matter into the prompt, body on demand) without writing anything outside plugin data. A skill file without `name`/`description` is skipped and reported. Both are read at `agent.create` time with a one-second cache keyed by directory mtime and exposed as `VaultStatus.injection`, so the screen can show "not injected", per-file bytes, and truncation. Injection applies to every agent on the daemon, skips `config.internal` agents, and never replaces the host's own prompt. Because `before("agent.create")` is the only hook that can change `systemPrompt` or `mcpServers`, the screen states that both apply to new agents.
- **Client:** four contributions — a screen, its sidebar item, a settings screen, and the attachment source. No push channel exists, so the shared status hook polls `statusRpc` (fast while `starting`, then slowly, following `plugins/devenv/client/status.tsx`) and stops on unmount. All presentation tokens come from `PluginHostProps.theme` and `layout.compact`; see the UI design document for screens, states, and copy.

## 4. Code layout (the conformance contract)

```text
plugins/obsidian/
  paseo-plugin.json          { id: "obsidian", name: "Obsidian vault", requirements: { paseo: ">=0.11.0" } }
  package.json               @pelikanade/paseo-plugin-obsidian, private: true
  README.md                  prerequisite (npm i -g obsidian-headless, Node ≥ 22), token, usage
  tsconfig.json
  index.server.ts            installVault(server, options)
  index.client.tsx           screen + sidebar item + settings screen + attachment source
  shared/
    contracts.ts             all Zod RPC contracts, the status union, and injection schemas
  server/
    install.ts               deep module: wiring, init promise, cleanup, agent.create hook
    credentials.ts           token file read/write/clear, 0600, validation against the CLI
    ob.ts                    binary discovery, version check, spawn helpers, JSON parsing, exit codes
    watcher.ts               continuous-process supervision, backoff, lastSuccessAt, staleness
    vault.ts                 path jail, listing, glob, grep, read, metadata (no binary content)
    injection.ts             prompt-block assembly, 32 KB caps, cache, truncation report
    gateway.ts               loopback MCP HTTP gateway and the four read tools
    search.ts                attachment-picker search over the vault
  client/
    vault-screen.tsx         global screen: status, setup entry point, injection state, browser
    sidebar.tsx              `addSidebarHeaderItem` row that opens the screen
    settings.tsx             settings screen: token, ob path, vault choice, Sync now
    attachment.ts            attachment-source definition and inserted-text builder
    status.ts                polling hook and status presentation helpers
    ui.tsx                   shared rows, badges, and empty/error states
e2e/obsidian.e2e.mjs         default suite: unconfigured, seeded vault, tools, injection, UI
e2e/obsidian-sync.e2e.mjs    credential-gated suite: real login, pull-only sync, no upload
```

Boundary rules: `shared/` imports no runtime module; `client/` imports no Node built-ins and no server code; `server/` imports no React.

## 5. Complexity and budget

- ≤ 17 code files under `plugins/obsidian/` (8 server, 6 client, 1 shared, 2 entries) plus two E2E files; net new TypeScript/JavaScript ≤ 1,400 lines, with a 25% tolerance. This matches the existing separation level of `devenv` (about 20 files) at a smaller scope.
- Runtime dependencies: `@modelcontextprotocol/sdk` (as in `generative-ui`) and `zod`; no other new dependency, in particular no bundling of `obsidian-headless`.
- Slices: 4 for v0, plus one deferred slice (§7). One dependency is external and unavoidable: `ob` on the host, with the license and Node constraint documented rather than worked around.
- Static verification: no generated artifacts and no Bend model, so `pnpm -r --if-present verify` passes without a plugin `verify` script.

## 6. Behavior scenarios

Default suite (`e2e/obsidian.e2e.mjs`), inside a temporary `PASEO_HOME`, temp `XDG_CONFIG_HOME`, plugins enabled, real daemon, real Web UI, seeded managed directory, no credentials configured:

1. **Unconfigured state:** install the plugin, open the screen from its sidebar row, assert the checklist names the missing prerequisite steps; assert no `ob` process is spawned; assert `statusRpc` reports `unconfigured`.
2. **Tools against a seeded vault:** seed notes, attachments, `.obsidian/`, `.trash/`, and `Trash/`; create an agent; assert `list_vault`/`glob_vault`/`grep_vault`/`read_vault` return the expected files, that all three excluded prefixes are invisible, that `../../etc/passwd` and symlink escapes are rejected with a structured error, and that binary attachments return metadata only. Assert every result carries `lastSuccessAt` and `stale`.
3. **Injection:** with `.paseo/system.md` and two skill files present, assert a new agent's session config carries the plugin instructions, then the system file's text, then one index line per skill in name order; assert the skill bodies are not in the prompt but are returned unchanged by `read_vault`; with the files absent, assert nothing is injected and the screen reports "not injected"; with a skill file missing front matter, assert it is skipped with the reason reported; with a 33 KB system file, assert truncation at the cap and the warning in `VaultStatus.injection`.
4. **Picker:** assert `searchRpc` returns matching notes with `id`, `identifier`, `title`, `url` (an `obsidian://` link that `z.url()` accepts), and `text` containing the path plus a snapshot truncated at 8 KB; assert an unready vault returns no items instead of failing.
5. **Read-only guarantee:** assert the gateway exposes exactly four tools and no write tool, and assert the status RPC reports mode `pull-only` with config syncing off, derived by the server from `ob sync-config --json` rather than by reading private files.
6. **Recovery:** point the plugin at a non-existent `ob` path and assert `ob_missing` with a repair action, then point it at a real installation and assert recovery without a daemon restart; send a rejected token through `tokenSetRpc` and assert `rejected`, then assert `tokenClearRpc` removes the stored copy.
7. **UI:** in Playwright against the real Web UI, open the screen from the sidebar row, run the picker flow, select a vault from settings, and assert rendered feedback rather than RPC payloads.

Credential-gated suite (`e2e/obsidian-sync.e2e.mjs`), requires `OBSIDIAN_AUTH_TOKEN` for a test account and a throwaway remote vault, plus `obsidian-headless` on `PATH`; fails with an explicit prerequisite error when they are absent, and is documented in the plugin README:

8. **Real pull:** select the test vault in settings, assert notes appear in the managed directory and `lastSuccessAt` advances.
9. **Pull-only holds:** write a file directly into the managed directory, force a sync, assert the file is not uploaded (verified by reading the remote through a second, freshly set-up managed directory) and that the local copy is left alone.
10. **Continuous and stale:** with the watcher running, add a note remotely and assert it appears; suspend the watcher's network access and assert `starting` then `stale` after the threshold, then recovery.

## 7. Slices (to-tickets; merge = permission to file)

- **S1 — Setup path and honest unconfigured state.** Manifest, package, entries, `shared/contracts.ts`, `server/credentials.ts`, `server/ob.ts`, minimal `server/install.ts`, the settings screen, the screen skeleton with its sidebar row, scenario 1 and the `ob_missing`/token halves of scenario 6.
- **S2 — Supervised pull-only sync.** `server/watcher.ts`, `remotesRpc` and settings-driven vault selection, status derivation with `lastSuccessAt` and staleness, manual sync, status rendering, scenarios 5 and 6 completion, plus the credential-gated scenarios 8–10.
- **S3 — Agents read the vault.** `server/vault.ts`, `server/gateway.ts`, `server/injection.ts`, the `agent.create` hook, the prompt block, scenarios 2 and 3.
- **S4 — Pickers and browsing.** `server/search.ts`, the attachment source, `client/attachment.ts`, the screen's vault browser, the UI polish from the UI design document, scenarios 4 and 7.
- **Slice B — read-write (deferred, not v0).** Write tools with content-hash optimistic locking, `ob sync-config --mode bidirectional`, push timing, write scope excluding `.obsidian/` and the trash folders, and how a mode flip reaches running agents (MCP configuration is fixed at agent creation, so a flip affects new sessions and offers an explicit reload). Documented here so v0's contracts do not block it: the gateway would gain `write_vault` and `append_vault`, and `VaultStatus` gains an access mode.

## 8. Open questions

- None blocking for v0. The remaining implementation detail belongs to S2: which line of the watcher's progress output marks a completed pull, since `lastSuccessAt` depends on it, and whether a rejected token is distinguishable from an unreachable remote in stderr.
- Skill files are delivered as a prompt index, decided in round 6: `.paseo/system.md` inline, `.paseo/skills/*.md` as name/description/path lines with bodies read on demand. Mirroring them into a provider-scanned skill directory (`~/.agents/skills`, `.codex/skills`) so they appear as native `SKILL.md` entries is a deliberate non-goal for v0, because it writes outside plugin data, only takes effect for new sessions, and would need ownership bookkeeping; it would change only `server/injection.ts` if it is ever wanted. The icon name for the sidebar row is validated by the host at registration time and will be confirmed in S4.
- Slice order and the complexity budget in §5 need the user's confirmation before implementation.

## Amendments

- 2026-10-13: the workspace upgraded `@getpaseo/cli`, `@getpaseo/client`, `@getpaseo/plugin`, and `@getpaseo/protocol` from 0.10.2 to 0.11.2, matching the daemon on the development machine, and migrated `plugins/hello-paseo` from `addSurface`/`addSidebarItem` to `addScreen`/`addSidebarHeaderItem`. This design now targets 0.11.2: UI registers with `addScreen` and `addSidebarHeaderItem`, the `ob` process is supervised with `spawnProcess`/`terminateProcess`, and the manifest requires `>=0.11.0`. The earlier 0.10.2 grounding is in the grill transcript.
- 2026-10-13 (implementation, slices S1–S4): `VaultStatus` gained `sync: { mode, configs } | null`, read with `ob sync-config --json`, because §6 scenario 5 asserts the enforced `pull-only` configuration and no declared field carried it. The screen's browser follows the selected vault (`vault` in `VaultStatus`) rather than the token, because it reads the local copy and errors must not clear it; the unconfigured case still shows the setup checklist. The picker hides paths whose segments start with `.`, so `.paseo/` and other dot directories never appear as attachable notes. `VaultStatus.injection.skills` marks a skill file without `name`/`description` as `not_injected`, which is what "skipped and reported" means in the declared schema. The credential-gated suite lives at `e2e/live/obsidian-sync.e2e.mjs` behind `pnpm test:obsidian` instead of `e2e/obsidian-sync.e2e.mjs`, because an account-backed suite in the default `e2e/*.e2e.mjs` glob would fail `pnpm check` on every machine without an Obsidian account; it requires `OBSIDIAN_AUTH_TOKEN` and `OBSIDIAN_E2E_VAULT` and fails with a prerequisite error rather than skipping. Scenario 10's remote-change half is dropped: the CLI has no way to delete a remote vault or file, so mutating a shared account vault from a test is not acceptable; the suite covers scenarios 5, 8 and 9 plus the 0600 credential file and token removal. `e2e/support/runtime.mjs` gained `ensureOb`, which uses `ob` from `PATH` or installs the pinned `obsidian-headless@0.0.14` into a test-owned npm prefix, so the default suite runs a real CLI without the plugin or the workspace depending on it. The plugin's `tsconfig.json` adds `ES2024.Promise` to `lib` for `Promise.withResolvers`. Scenario 6's `ob_missing` error code needs a stored token, so the default suite asserts the probe half (no `ob.path`, no sync process, recovery on a settings change) and the credential-gated suite covers the error code. The implementation keeps §4's file layout exactly (17 code files: 2 entries, 1 shared, 8 server, 6 client) but lands at ≈3,500 TypeScript lines instead of §5's ≤1,400: the UI design's copy deck (§ Copy deck, ≈250 lines), its state matrix with banners, checklist, confirmations and the browser/reader, and the glob/grep/jail implementation for the vault tools are all mandated by the design and account for the difference; no speculative code was added. The recovery toast and the "Last copy" marker from the UI design are implemented in the screen.
- 2026-10-14 (presentation redesign, second pass): the `client/` layer was redesigned against tasteskill v2 (`design-taste-frontend`) and its `redesign-existing-projects` companion from github.com/Leonxlnx/taste-skill, applied by a Haiku 5.5 agent (`omp/magpie/group/auto-claude-haiku-5-5`) in this worktree; the skill's web-only parts (custom palettes, imagery, web fonts, motion layers, its browser inspector) were excluded because the host fixes the theme and the components. What changed: one 24pt headline carrying the vault name; one status line (dot + label, a plain `Read-only`, a ghost `Open settings`); facts as label/value pairs instead of a `Vault` field repeated from the headline; `surface1` panels as the only container, with no borders, pills or left rules; the setup checklist in one panel with a single content-width primary action; a 760pt document column; four type sizes (24/16/14/12) replacing seven near-equal ones; the accent reserved for the primary action and status dots; sentence-case section labels (`Agent instructions`, `Vault files`, `Connection`, `Obsidian CLI (ob)`, `Vault`) replacing the uppercase labels in the UI design's § Copy deck, since tiny tracked capitals are a house-style tell; `readOnlyLine` lost its redundant `Read-only.` prefix; `Last copy` reads "Showing the last copy."; one unused copy key (`noVaultSelected`) was deleted. Behaviour, RPC contracts, registered ids, accessibility labels and the state matrix are unchanged; `pnpm test:e2e` passes 9/9 on the redesigned revision along with typecheck, lint and formatting. Two e2e assertions are scoped to the host `settings-detail-pane` testID because the previously opened screen stays mounted and duplicates the `Obsidian CLI (ob)` and `Vault` strings; that is a selector change, not a weaker assertion. The UI design document's visual direction and label case are superseded by this pass; its state matrix, error table and copy intent still govern.
- 2026-10-14 (layout pass, after review): the screen's read-only file browser and its note reader were removed, together with `listRpc`/`readRpc` in `shared/contracts.ts` and their handlers in `install.ts`; the MCP tools `list_vault`/`read_vault` are the only readers now, so §2's contract table, §4's `vault-screen.tsx` line, §6's browser steps and §7's "Pickers and browsing" description of the browser are superseded. `server/vault.ts` is unchanged and still serves the tools, `injection.ts` and `search.ts`. `injectionFileSchema` gained `name` and `description`, filled from each skill's front matter, so the client can present a skills list instead of injection bookkeeping; `VaultStatus.injection.systemPrompt` remains in the contract and in the E2E but is no longer rendered. The screen is now the status block, the facts (`Last sync`, `Tools`) and a **Skills** list — name, description, and a note for a skipped or truncated file — closing with "Applies to new agents only."; the uppercase section labels of the UI design are gone. The setup checklist moved into settings as a **Set up** section shown while the vault is unconfigured, and the token's Save and Remove actions share one row instead of two. `pnpm test:e2e` passes 8/8: the browser-RPC scenario was dropped and its unique coverage folded into the MCP-tool and picker scenarios, and the UI scenario now asserts the skills list, the settings checklist and that both token buttons share a row by comparing their bounding boxes. Both skills lists are tables: the screen shows name, description, status and size on a wide pane and, on a compact one, the name with its size on the first line and the description and status as label/value pairs; settings shows path, status and size. The long per-file status sentences (`Truncated at 32 KB. Shorten the file.`, `Not injected. Create <path>.`) became the short column values `Injected`, `Truncated` and `Not injected`, since the row already names the file. A later trim removed the remaining explanatory prose from both surfaces: the screen keeps the vault name, the status line, `Last sync`, the tools list, the skills table and the actions, and loses `Agents can list, search and read notes…`, the setup hint, `Applies to new agents only.` and the always-on `Host:` line; settings loses the token, `ob` path and vault hints and the read-only sentence under the vault select. The facts those lines carried stay in the design documents and the plugin README (`Read-only`, `What agents get`, the 0600 token that is never shown again, and the new-agents-only rule). Error banners, staleness warnings, toasts and the confirmation dialogs keep their text: they are state, not description. The token section is now two segments: the default one shows the token state with **Set up vault** (or **Replace token** plus **Remove token** when one is stored) and no input, and pressing the action reveals the paste field with **Save token** and **Cancel**, focused, in one row. A saved token collapses the section again; a rejected one keeps the field filled so the next token can be pasted. The `ob path` field and its save action render only once the status has loaded and `status.ob.source` is not `path`: a PATH install shows the fact row alone, and a stored or broken override brings the field back, with the placeholder `Path or name of ob`; clearing it returns to PATH discovery. The connection section is a single row as well: the token state and one action (`Set up vault` when nothing is stored, `Change token` when one is), with `Remove token` moved into the edit segment beside `Save token` and `Cancel`. The settings Skills section and its table were removed; the skills table lives on the screen only. The remote vault is one row too: the selected name with **Change vault** and **Sync now** beside it. The host `SettingsSelect` is replaced by a modal picker listing the remote vaults (with loading, token-missing, empty and error lines), the switch confirmation is unchanged, and **Sync now** is disabled until a token is stored instead of reporting the `ob_missing` copy; the `unconfigured` branch now uses a neutral toast. The onboarding is now the rows themselves, in order: the `Set up` checklist is gone (it restated the token, CLI and vault rows), the vault row renders only when a token is stored or a vault is configured so a fresh install shows no dead control, saving the first token opens the vault picker immediately, and choosing a vault starts the pull with the first sync observed as the screen's state instead of a checklist step. `Change vault` and `Sync now` are enabled rather than silently disabled: the picker reports a missing token itself and `Sync now` answers with a neutral toast. Skills moved from the hidden `.paseo/skills/` to a visible `Skills/` folder at the vault root, and `.paseo/system.md` was dropped with the rest of the hidden directory: the plugin now writes and expects nothing hidden inside the vault, so §3's injection convention and the UI design's `.paseo/system.md` row are superseded. `VaultStatus.injection` is `{ skills }` only, and the instructions in the prompt name the folder and tell the agent to list it with `glob_vault "Skills/*.md"`. Measured against Paseo 0.11.2: `paseo agent reload` does not re-run the `agent.create` hook (the persisted prompt came back byte-identical, 742 bytes, still listing only the skill that existed at creation), and `before("agent.session_open")` carries `env` only, so no plugin can refresh a prompt on reload. The tools are live, so a skill added later is readable immediately after a reload; the prompt index is therefore a hint that can lag, and the folder is the authority. An E2E scenario pins the tool half of that: a `Skills/delta.md` written after creation is listed by `glob_vault` and read by `read_vault` once the agent is reloaded.
- 2026-10-18 (recursive skills): `Skills/` is read recursively, and only files that are skills are injected or listed: a skill folder's `SKILL.md` at any depth, or a `Skills/*.md` file, with both `name` and `description` front matter. Index notes such as `Skills/index.md` and `references/*.md` resources no longer appear in `VaultStatus.injection.skills` even when they carry front matter, so `injectionStatusSchema` drops the unreachable `not_injected` value and the screen's `Not injected` column value, and `injectionFileSchema` makes `name`, `description`, `bytes` and `modifiedAt` non-null. Front matter parsing now unfolds YAML block scalars (`>-`, `|`), which the vault's `SKILL.md` files use; the previous parser stored the literal `>-` as the description. The prompt tells agents to list skills with `glob_vault "Skills/**/SKILL.md"` and `glob_vault "Skills/*.md"`.
