# Obsidian vault

Gives every agent on the daemon read-only access to one Obsidian vault. A supervised
`ob sync --continuous` process keeps a plugin-owned local copy up to date, four MCP tools read it,
`agent.create` appends vault instructions to the system prompt, and the composer can attach a note.

## Prerequisite: the Obsidian headless CLI

Sync runs the official `obsidian-headless` client. Install it on the daemon machine:

```sh
npm install -g obsidian-headless
```

It needs Node ≥ 22, and `ob` must be on the daemon's `PATH` or set explicitly in settings. Settings
offers the `ob path` field and its save action only when discovery fails or when an override is
already stored, so an `ob` on `PATH` needs no configuration. The
package is `UNLICENSED` (Dynalist Inc.), so this plugin never bundles, fetches or installs it. Without
it the plugin still serves an existing local copy, reports `ob_missing` once a vault is selected, and
shows the repair in settings.

## Setup

1. Log in once with the CLI, then copy the token from `~/.config/obsidian-headless/auth_token`:

   ```sh
   ob login
   ```

2. Open Settings → Plugins → Obsidian vault, press **Set up vault** (or **Change token**), paste the token
   and press **Save token**. The token state and that one action share a single row; the paste field,
   **Save token**, **Cancel** and, with a token stored, **Remove token** appear only while editing. The token is
   validated against Obsidian before it is stored, as mode 0600, at
   `$PASEO_HOME/plugin-data/obsidian/token`, and is never shown again by the plugin or the app. It is never put in the host settings document.
3. Saving the first token opens the vault picker. Choosing a vault runs `ob sync-setup`, forces
   `ob sync-config --mode pull-only --configs ""`, and starts the watcher; the first pull is automatic
   and shows up as the screen's sync state, not as a step. The **Remote vault** row appears once there
   is a token to list vaults with or a vault already configured, and offers **Change vault** and
   **Sync now** beside the selected name.

Sync pulls the vault into `$PASEO_HOME/plugin-data/obsidian/vault`. The CLI's own state stays in
`$PASEO_HOME/plugin-data/obsidian/config`, so it never touches a separate `ob` login on the same
machine.

## What agents get

- The `obsidian` MCP server with `list_vault`, `glob_vault`, `grep_vault` and `read_vault`. Paths are
  vault-relative; `.obsidian/`, `.trash/` and `Trash/` are not readable, and symlinks that leave the
  vault are rejected. Every result carries `lastSyncedAt` and `stale`.
- A prompt block with the vault's instructions and one index line per `Skills/*.md` at the vault root
  (front-matter `name`, `description`, path), capped at 32 KB per file. The block also tells the agent
  that the `Skills` folder is the authority and to list it with `glob_vault "Skills/*.md"`; skill bodies
  stay in the vault and are read on demand with `read_vault`, and a file without front matter is
  skipped.

Both are fixed when an agent is created: the tools read the vault live, so a skill added later is
readable at once (including after `paseo agent reload`), while its index line appears in the prompt of
agents created afterwards.

## Read-only

Two things are enforced, not promised: the MCP server registers no write tool, and sync runs in
`pull-only` mode, so local changes are ignored and never uploaded. The vault directory itself is an
ordinary directory for the daemon user, so an agent with shell access can still reach it, and a file
written there is not protected from the next sync. Attachments (images, PDFs) are returned as path,
size and modification time only.

## Composer

The attachment picker gets one source, **Obsidian vault**. Picking a note inserts
`<vault-relative path>` plus a snapshot of at most 8 KB, ending in `[truncated]` when the note is
longer. Notes deeper than 50 results are ordered by note name; a vault that is not ready returns no
items instead of an error.

## Screen and status

The sidebar row **Obsidian vault** opens a screen with the sync state, the last successful sync, the
tools agents receive, and a table of the vault's skills: each `Skills/*.md` file with its
front-matter name and description, its injection status and its size. It reads the plugin's local
copy, so a sync error never empties it. Setup lives in settings, one row per thing that needs
configuring: the token, the `ob` path (offered only when discovery fails) and the remote vault, where
**Change vault** and **Sync now** sit beside the selected name.

`VaultStatus.sync` reports what the CLI holds, read with `ob sync-config --json`: `pull-only` with an
empty `configs` list is the enforced read-only configuration.

## Limits

- One vault per daemon. There is no per-workspace vault, no second vault, and no vault path setting.
- No write tools, no push and no read-write switch in this version. Content-hash locking and the mode
  flip are deferred.
- No semantic search over tags, front matter or the link graph; `[[wikilinks]]` are not resolved.
- Skills live in the vault's own `Skills` folder. The plugin writes nothing into the vault and needs no
  hidden directory there; it reads the folder and nothing else.
- `.obsidian/` is not synced, so the vault's configured trash folder name is unknown: both `.trash/`
  and `Trash/` are refused.
- An end-to-end encrypted vault cannot be set up: the CLI would need its encryption password and this
  plugin holds none.
- Staleness is measured from the last successful sync this plugin observed (15 minutes), not from a
  timestamp in the CLI.

## Tests

`pnpm test:e2e` covers the unconfigured state, the four tools over a seeded vault, escaping paths,
injection, the picker, the `ob` probe and the whole Web UI flow through a real daemon with no
credentials. The suite provisions the official `obsidian-headless` package when `ob` is not on
`PATH`.

Real Sync needs an account, so it lives in a separate suite that fails with a prerequisite error
instead of skipping:

```sh
OBSIDIAN_AUTH_TOKEN=... OBSIDIAN_E2E_VAULT="<throwaway vault id or name>" pnpm test:obsidian
```

It logs in, pulls that vault, asserts `pull-only` with config syncing off, proves a local note is
never uploaded by pulling the same vault into a second directory, and checks that clearing the token
stops sync and removes the local copy. Use a throwaway vault that already holds at least one note.
