# Design: paseo-obsidian

Issue: none — planning branch. Grill: `docs/design/_intake/paseo-obsidian-grill.md` @ 2026-10-13. Scaffold: none.
Glossary: `GLOSSARY.md` (+10 terms). ADRs: `docs/adr/0001-headless-sync-through-the-official-cli.md`, `0002-read-only-binds-tools-and-sync-direction.md`, `0003-one-global-vault.md`. UI: `docs/design/paseo-obsidian-ui.md`.
Method: mattpocock/skills (grill-with-docs, domain-modeling). Approval: pending — rounds 1–4 settled, slice plan and budget await confirmation.

## 1. Problem and done

- **Done predicate:** With the plugin installed on a daemon that has `obsidian-headless` on `PATH` (or a configured path), and with a pasted account token plus one selected remote vault, one supervised `ob sync --continuous` process keeps `$PASEO_HOME/plugin-data/obsidian/vault` in `pull-only` sync. Every agent created on the daemon receives an `obsidian` MCP server exposing read-only `list`, `glob`, `grep`, and `read` over that vault, and gets the vault's `.paseo/system.md` plus every `.paseo/skills/*.md` appended to its system prompt. The composer's attachment picker searches notes and inserts a vault-relative path plus a content snapshot capped at 8 KB. A global "Obsidian vault" surface with a sidebar item shows sync state, last successful sync, vault identity, and injection status; a settings screen holds the token, the vault selection, and the `ob` path. No tool writes, and the client never uploads local changes.
- **Non-goals / out of boundary:** Write tools, push, and the read-only↔read-write switch (slice B, §7); semantic search over tags, frontmatter, and the link graph; `[[wikilink]]` and title resolution; Obsidian Publish; slash commands; command-centre items; per-workspace vault binding; multiple simultaneous vaults; filesystem-level enforcement of read-only; syncing `.obsidian/` configuration; operating-system notifications; filesystem watching of the managed directory.
- **Constraints found while grounding:**
  - `obsidian-headless@0.0.14` is `license: UNLICENSED`, published by Dynalist Inc., requires Node ≥ 22, ships the `ob` binary (`cli.js`) with `better-sqlite3` and `commander`. The plugin must never bundle or fetch it; it is a documented host prerequisite.
  - Authentication accepts `OBSIDIAN_AUTH_TOKEN` in the environment, overriding `<config>/auth_token`. On Linux the CLI config directory is `$XDG_CONFIG_HOME/obsidian-headless`, otherwise `~/.config/obsidian-headless`; the CLI writes `auth_token` with mode 0600 and creates the directory with 0700.
  - `ob sync-config` sets `--mode bidirectional|pull-only|mirror-remote`, `--conflict-strategy merge|conflict`, `--file-types`, `--configs`, `--excluded-folders`, `--config-dir` (default `.obsidian`). `ob sync-setup --vault <id-or-name> --path <dir>` registers a vault. `ob sync --path <dir> --continuous` keeps a live connection, reconnects after disconnect, and retries. The CLI keeps a lock at `<config-dir>/.sync.lock` inside the vault and refuses to start a second sync for it. `sync-list-remote`, `sync-list-local`, `sync-status`, and `sync-config` accept `--json`; errors go to stderr with a non-zero exit. `sync-status --json` reports configuration only — `vaultId`, `vaultName`, `vaultPath`, `syncMode`, `conflictStrategy`, `deviceName`, `configDir`, `fileTypes`, `configs`, `excludedFolders` — and carries no last-sync timestamp. Observed exit codes: 3 when the path has no sync configuration, 2 when the E2EE key is missing, 1 otherwise.
  - Paseo 0.10.2 has no `$`-mention feature and no mention extension point; the only composer picker a plugin can add is an attachment source (`addAttachmentSource` + a `search` RPC returning `PluginAttachmentSearchPayload`). The host's own `@` autocomplete covers workspace files only and is not extensible.
  - Paseo 0.10.2 has no plugin skill registry: bundled skill text is delivered by concatenating into `config.systemPrompt` inside `server.before("agent.create", ...)` (the `devenv` pattern). MCP servers are contributed the same way through `config.mcpServers`. Tool preapproval is `config.toolPolicy.preapproved`.
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

The client registers a global surface, its sidebar entry, a settings screen, and the composer picker:

```tsx
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addSurface("vault", VaultSurface),
    client.addSidebarItem({
      id: "vault",
      title: "Obsidian vault",
      icon: "Notebook",
      surface: "vault",
    }),
    client.addSettingsScreen({
      id: "obsidian",
      title: "Obsidian vault",
      icon: "Settings",
      Component: VaultSettings,
    }),
    client.addAttachmentSource(
      defineAttachmentSource({
        id: "obsidian",
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

Every client operation is one RPC against the shared contracts:

```ts
const status = await rpc(statusRpc, {}); // panel + tool freshness
const { vaults } = await rpc(listVaultsRpc, {}); // ob sync-list-remote --json
await rpc(saveTokenRpc, { token: pasted }); // validates, stores 0600
await rpc(selectVaultRpc, { vaultId, vaultName }); // sync-setup + pull-only config
await rpc(syncNowRpc, {}); // stop watcher, one-shot sync, restart
const { items } = await rpc(searchRpc, { query: "weekly" }); // attachment picker results
const injection = await rpc(injectionRpc, {}); // which files feed the prompt
```

The RPC surface, all defined in `shared/contracts.ts`:

| Contract         | Input                    | Output                                          |
| ---------------- | ------------------------ | ----------------------------------------------- |
| `statusRpc`      | `{}`                     | `{ sync, injection, readOnly: true }`           |
| `saveTokenRpc`   | `{ token }`              | `status` (validated against `sync-list-remote`) |
| `clearTokenRpc`  | `{}`                     | `status`                                        |
| `listVaultsRpc`  | `{}`                     | `{ vaults: { id, name }[] }`                    |
| `selectVaultRpc` | `{ vaultId, vaultName }` | `status`                                        |
| `syncNowRpc`     | `{}`                     | `status`                                        |
| `searchRpc`      | `{ query }`              | `PluginAttachmentSearchPayload`                 |
| `injectionRpc`   | `{}`                     | `{ system, skills, truncated }`                 |

`status.sync` is a discriminated union: `unconfigured`, `starting`, `watching`, `stale`, `error`, each carrying `vaultName`, `lastSyncedAt` (ISO string or null), `pid` (number or null), and for `error` a `{ code, message }` where `code` is one of `ob_missing`, `ob_too_old`, `token_invalid`, `vault_missing`, `remote_unreachable`, `lock_held`, `sync_failed`.

Agents see only tools and prompt text:

- MCP server `obsidian` (HTTP, loopback, bearer token per agent) with `list_vault`, `glob_vault`, `grep_vault`, `read_vault`. Every result carries `lastSyncedAt` and `stale: boolean`.
- A prompt block appended after the host's own `systemPrompt`: the plugin's short instructions, then `.paseo/system.md`, then each `.paseo/skills/*.md` in file-name order, each preceded by its vault-relative path. No vault path is injected into the environment.

The four tools, and the picker, are specified so slices S3 and S4 have exact contracts:

| Tool         | Input                                                                                           | Output                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `list_vault` | `{ path?: string, depth?: number }`                                                             | `{ entries: { path, name, type, size, modifiedAt }[], truncated }`                              |
| `glob_vault` | `{ pattern: string, limit?: number }`                                                           | `{ paths: string[], truncated }`                                                                |
| `grep_vault` | `{ query: string, regex?: boolean, caseSensitive?: boolean, include?: string, limit?: number }` | `{ matches: { path, line, text }[], truncated }`                                                |
| `read_vault` | `{ path: string, offset?: number, limit?: number }`                                             | `{ path, text, truncated, bytes, modifiedAt }` or `{ error: "binary_file", bytes, modifiedAt }` |

Every tool result additionally carries `{ vault: { name }, lastSyncedAt, stale }`. Fixed limits: 1,000 entries for `list_vault`, 200 paths for `glob_vault`, 100 matches or 200 KB for `grep_vault`, 256 KB per `read_vault` call. `grep_vault` skips files whose first 8 KB contains a NUL byte, so images, PDFs, and other attachments never enter the text path. Paths are vault-relative, are resolved through the jail in `server/vault.ts`, and any escape, symlink out of the vault, or entry under `.obsidian/` or `Trash/` returns a `path_denied` error instead of an empty result.

The picker's `searchRpc` matches case-insensitively on path substring and note name (`id` and `identifier` are the vault-relative path, `title` the note name, `subtitle` the parent folder, `url` an `obsidian://open?vault=<name>&file=<path>` link), returns at most 50 items ordered by note name, and puts `<path>` followed by a content snapshot of at most 8 KB into `text`, ending with a truncation marker when the note is longer.

## 3. Strategy

- **Chosen shape:** `installVault(server, options): PluginCleanup` is the only server interface. It synchronously registers RPC handlers and the `agent.create` before-hook, then owns one private initialization promise, the credential file, `ob` discovery and verification, vault registration, watcher supervision with backoff, status derivation, the vault reader, the injection reader, and the MCP gateway; it returns cleanup that stops the watcher, closes the gateway, and removes listeners. **Interface depth:** callers cannot bypass credential validation, pull-only configuration, single-instance enforcement, or cleanup. **Seams:** the RPC contracts in `shared/contracts.ts` separate client transport from the server module, and the `ob` invocation point takes the binary path and environment so the daemon host and E2E can point it at a real binary.
- **Alternatives (design it twice):**
  - Inline everything in `index.server.ts` with module-level state — least ceremony, rejected because credential handling, watcher lifecycle, and the gateway would share one file and cleanup would be hard to prove.
  - Export a `Vault` service class with methods per operation and let the entry orchestrate — explicit and testable, rejected because it duplicates the RPC-shaped surface and lets the entry skip initialization ordering.
  - Install-only deep module — chosen, matching the `devenv` and `paseo-nstack` precedent in this repository.
- **Sync transport:** spawn the official CLI rather than reimplementing or depending on a reverse-engineered client. The mode is set to `pull-only` at configuration time, so the client itself ignores local changes; `--configs ""` keeps `.obsidian/` configuration out of the managed directory; `--conflict-strategy merge` is left at the default.
- **Isolation:** child processes get `OBSIDIAN_AUTH_TOKEN` from the plugin's own 0600 file and `XDG_CONFIG_HOME` pointed at the plugin data root (with `HOME` untouched), so the CLI's own credential and state files never conflict with a user's separate `ob` login, and the shipped `auth_token` file stays inside plugin data.
- **Watcher supervision:** one process at a time, guarded by an in-process flag and the CLI's `<config-dir>/.sync.lock`; on unexpected exit, restart with exponential backoff (1s, 2s, 4s… capped at 60s), reporting `starting` while reconnecting and `error` with the last stderr line only after repeated failures. Reconnection inside a live process is delegated to the client. Because `sync-status --json` carries no timestamp, `lastSyncedAt` is the plugin's own record: the time of the last successful sync completion it observed, refreshed from the watcher's progress output and from a completed one-shot `ob sync`. A successful sync older than 15 minutes marks results `stale`, and a failure to complete any sync within that window surfaces as `stale` rather than `error` as long as the process is alive.
- **Freshness and failure:** tools never block. Unconfigured, invalid token, unreachable remote, and missing vault return structured errors; stale data returns content plus the staleness marker. The panel offers the matching repair action for each code.
- **MCP tools:** follow the `generative-ui` gateway pattern — one loopback HTTP MCP server in the plugin process, per-agent bearer token minted in `before("agent.create")`, `Host`/`Origin` checks, POST-only, request cap. Read handlers resolve every path through one jail function (`realpath` containment check plus a `.obsidian/` and `Trash/` deny list) and never expose binary content, only path, size, and mtime.
- **Injection:** read `.paseo/system.md` and `.paseo/skills/*.md` from the managed directory at `agent.create` time with a one-second cache keyed by directory mtime; cap each file at 32 KB with a truncation marker; skip missing files silently and expose the outcome through `injectionRpc` so the surface can say "not injected". Injection applies to every agent on the daemon, skips `config.internal` agents, and never replaces the host's own prompt.
- **Client:** four contributions; no push channel exists, so the surface polls `statusRpc` (the `devenv` `refresh.ts` pattern) and stops on unmount. All presentation tokens come from `PluginHostProps.theme` and `layout.compact`; see the UI design document for screens and states.

## 4. Code layout (the conformance contract)

```text
plugins/obsidian/
  paseo-plugin.json          { id: "obsidian", requirements: { paseo: ">=0.10.2" } }
  package.json               @pelikanade/paseo-plugin-obsidian, private: true
  README.md                  prerequisite (npm i -g obsidian-headless, Node ≥ 22), token, usage
  tsconfig.json
  index.server.ts            installVault(server, options)
  index.client.tsx           surface + sidebar item + settings screen + attachment source
  shared/
    contracts.ts             all Zod RPC contracts, the status union, and injection schemas
  server/
    install.ts               deep module: wiring, init promise, cleanup, agent.create hook
    credentials.ts           token file read/write/clear, 0600, validation against the CLI
    ob.ts                    binary discovery, version check, spawn helpers, JSON parsing, exit codes
    watcher.ts               continuous-process supervision, backoff, lastSyncedAt, staleness
    vault.ts                 path jail, listing, glob, grep, read, metadata (no binary content)
    injection.ts             prompt-block assembly, 32 KB caps, cache, truncation report
    gateway.ts               loopback MCP HTTP gateway and the four read tools
    search.ts                attachment-picker search over the vault
  client/
    vault-surface.tsx        global surface: status, vault picker, injection state, browser
    settings.tsx             settings screen: token, ob path, vault selection, manual sync
    attachment.ts            attachment-source definition and inserted-text builder
    status.ts                polling hook and status presentation helpers
    ui.tsx                   shared rows, badges, and empty/error states
e2e/obsidian.e2e.mjs         default suite: unconfigured, seeded vault, tools, injection, UI
e2e/obsidian-sync.e2e.mjs    credential-gated suite: real login, pull-only sync, no upload
```

Boundary rules: `shared/` imports no runtime module; `client/` imports no Node built-ins and no server code; `server/` imports no React.

## 5. Complexity and budget

- ≤ 16 code files under `plugins/obsidian/` (8 server, 5 client, 1 shared, 2 entries) plus two E2E files; net new TypeScript/JavaScript ≤ 1,400 lines, with a 25% tolerance. This matches the existing separation level of `devenv` (about 20 files) at a smaller scope.
- Runtime dependencies: `@modelcontextprotocol/sdk` (as in `generative-ui`) and `zod`; no other new dependency, in particular no bundling of `obsidian-headless`.
- Slices: 4 for v0, plus one deferred slice (§7). One dependency is external and unavoidable: `ob` on the host, with the license and Node constraint documented rather than worked around.
- Static verification: no generated artifacts and no Bend model, so `pnpm -r --if-present verify` passes without a plugin `verify` script.

## 6. Behavior scenarios

Default suite (`e2e/obsidian.e2e.mjs`), inside a temporary `PASEO_HOME`, temp `XDG_CONFIG_HOME`, plugins enabled, real daemon, real Web UI, seeded managed directory, no credentials configured:

1. **Unconfigured state:** install the plugin, open the surface, assert it names the missing prerequisite steps; assert no `ob` process is spawned; assert `statusRpc` reports `unconfigured`.
2. **Tools against a seeded vault:** seed notes, attachments, `.obsidian/`, and `Trash/`; create an agent; assert `list_vault`/`glob_vault`/`grep_vault`/`read_vault` return the expected files, that `.obsidian/` and `Trash/` are invisible, that `../../etc/passwd` and symlink escapes are rejected with a structured error, and that binary attachments return metadata only. Assert every result carries `lastSyncedAt` and `stale`.
3. **Injection:** with `.paseo/system.md` and two skill files present, assert a new agent's session config carries the plugin instructions, then both files in name order with path headers; with the files absent, assert nothing is injected and the surface reports "not injected"; with a 33 KB skill file, assert truncation at the cap and the warning in `injectionRpc`.
4. **Picker:** assert `searchRpc` returns matching notes with `id`, `identifier`, `title`, `url` (an `obsidian://` link), and `text` containing the path plus a snapshot truncated at 8 KB.
5. **Read-only guarantee:** assert the gateway exposes exactly four tools and no write tool, and assert the status RPC reports mode `pull-only` with config syncing off, derived by the server from `ob sync-config --json` rather than by reading private files.
6. **Recovery:** point the plugin at a non-existent `ob` path and assert `ob_missing` with a repair action, then point it at a real installation and assert recovery without a daemon restart; paste a rejected token and assert `token_invalid`.
7. **UI:** perform the picker flow and the vault-selection flow in Playwright against the real Web UI, and assert rendered feedback rather than RPC payloads.

Credential-gated suite (`e2e/obsidian-sync.e2e.mjs`), requires `OBSIDIAN_AUTH_TOKEN` for a test account and a throwaway remote vault, plus `obsidian-headless` on `PATH`; fails with an explicit prerequisite error when they are absent, and is documented in the plugin README:

8. **Real pull:** select the test vault, assert notes appear in the managed directory and `lastSyncedAt` advances.
9. **Pull-only holds:** write a file directly into the managed directory, force a sync, assert the file is not uploaded (verified by reading the remote through a second, freshly set-up managed directory) and that the local copy is left alone.
10. **Continuous and stale:** with the watcher running, add a note remotely and assert it appears; suspend the watcher's network access and assert `starting` then `stale` after the threshold, then recovery.

## 7. Slices (to-tickets; merge = permission to file)

- **S1 — Setup path and honest unconfigured state.** Manifest, package, entries, `shared/contracts.ts`, `server/credentials.ts`, `server/ob.ts`, minimal `server/install.ts`, client settings screen, surface skeleton, scenario 1 and the `ob_missing`/`token_invalid` halves of scenario 6.
- **S2 — Supervised pull-only sync.** `server/watcher.ts`, vault listing and selection RPCs, status derivation with `lastSyncedAt` and staleness, manual sync, surface status rendering, scenarios 5 and 6 completion, plus the credential-gated scenarios 8–10.
- **S3 — Agents read the vault.** `server/vault.ts`, `server/gateway.ts`, `server/injection.ts`, the `agent.create` hook, the prompt block, scenarios 2 and 3.
- **S4 — Pickers and browsing.** `server/search.ts`, the attachment source, `client/attachment.ts`, the surface's vault browser, the UI polish from the UI design document, scenario 4 and 7.
- **Slice B — read-write (deferred, not v0).** Write tools with content-hash optimistic locking, `ob sync-config --mode bidirectional`, push timing, write scope excluding `.obsidian/` and `Trash/`, and how a mode flip reaches running agents (MCP configuration is fixed at agent creation, so a flip affects new sessions and offers an explicit reload). Documented here so v0's contracts do not block it: the gateway would gain `write_vault` and `append_vault`, and `status.readOnly` becomes a mode field.

## 8. Open questions

- None blocking. `sync-status --json` field names and the exit codes are now known (3 no sync configuration, 2 missing E2EE key, 1 otherwise). Still to confirm during S2: which line of the watcher's progress output marks a completed pull, since `lastSyncedAt` depends on it, and whether a rejected token is distinguishable from an unreachable remote in stderr.
- Slice order and the complexity budget in §5 need the user's confirmation before implementation.
