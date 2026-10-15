# Paseo Obsidian vault plugin: UI design

Status: design only. Nothing here ships. Plugin id `paseo-obsidian`.
Superseded in part: on 2026-10-14 the shipped presentation layer was redesigned in a tasteskill v2 pass (see the amendments in [paseo-obsidian.md](paseo-obsidian.md)). The visual direction below — its uppercase section labels, pills, outlined rules and type sizes — records the pre-redesign build; the state matrix, error table, screen inventory and copy intent remain authoritative. Injection changed as well: skills are read from a visible `Skills/` folder at the vault root and no system-prompt file is read or shown, so the `.paseo/system.md` rows and the injection mapping below record the earlier build.
Scope: v0 is read-only. Sync runs pull-only. The vault server exposes `list_vault`, `glob_vault`, `grep_vault`, `read_vault`. The client never uploads. There is no read-write switch, no write tools, and no mode toggle in v0. Read-write is covered only in the last section, marked deferred.

## Grounding

Host facts come from the installed SDK `@getpaseo/plugin@0.11.2`, react-native peer variant. `<sdk>` below means:
`node_modules/.pnpm/@getpaseo+plugin@0.11.2_@getpaseo+client@0.11.2_@getpaseo+protocol@0.11.2_react-native@_1c26d45f93d25f61399db47d70c0a2b6/node_modules/@getpaseo/plugin/dist`

This document was drafted against 0.10.2 and re-grounded on 0.11.2 on 2026-10-13, after the workspace upgraded CLI, client, and SDK together. The 0.11 API names are `addScreen` and `addSidebarHeaderItem`; `addSurface`, `addSidebarItem`, and `openSurface` are deprecated aliases that the repository lint rejects. A screen receives `PluginScreenProps` (surface props plus `params`); a sidebar item receives `PluginSidebarItemProps` (`currentScreen`, `openScreen`, `openPopover`) and renders its own row with `SidebarRow`.

Declarations read:

- `<sdk>/client/contracts.d.ts`: `PluginClientContext`, `PluginCommandCapabilities`, `PluginSurfaceProps`, `PluginScreenProps`, `PluginScreenLocation`, `PluginSidebarItemProps`, `PluginHostProps`, `PluginSettingsScreenContribution`, `SettingsState`
- `<sdk>/client/buttons.d.ts`: button behaviours (not used by this plugin)
- `<sdk>/contracts.d.ts`: `PluginTheme`, `PluginAttachmentSourceContribution`, `PluginThemeColors`, `PluginWorkspaceSnapshot`
- `<sdk>/attachments.d.ts`: `PluginAttachmentItemSchema`, `PluginAttachmentSearchPayloadSchema`, `defineAttachmentSource`
- `<sdk>/settings.d.ts`: `defineSettings`, `settingsRpc`, `SettingsReadResultSchema`, `SettingsWriteResultSchema`
- `<sdk>/client/ui.d.ts`: `SettingsSection`, `SettingsCard`, `SettingsRow`, `SettingsSwitch`, `SettingsSelect`, `SettingsInput`, `SettingsAction`, `ExternalLink`, `SidebarRow`, `SidebarSeparator`
- `<sdk>/client/react-native.d.ts`: `Modal`, `useToast`, `copyText`, `ScrollView`, `FlatList`, `TextInput`, `Icon`
- `<sdk>/client/index.d.ts`: `useSettings`, `useHosts`, `openExternalUrl`, `getPaseoClient`
- `<sdk>/client/rpc-context.d.ts`, `<sdk>/rpc.d.ts`: `useRpc`, `defineRpc`, `callPluginRpc`
- `<sdk>/client/host.d.ts`: `searchPluginAttachments(source, invoke, query)` calls `source.search` with `{ query }` only
- `<sdk>/server/contracts.d.ts`, `<sdk>/server/lifecycle.d.ts`, `<sdk>/server/provider.d.ts`: `registerSettings`, `handle`, `before("agent.create")`, `ProviderMcpServerConfig`, `ProviderSessionConfig.systemPrompt`
- `<sdk>/server/index.d.ts`: `spawnProcess`, `execCommand`, `terminateProcess` (available for supervising `ob` from the daemon side)
- House style: `plugins/devenv/client/ui.tsx`, `plugins/devenv/client/settings.tsx`, `plugins/devenv/client/status.tsx`, `plugins/devenv/client/status-icon.tsx`, `plugins/devenv/shared/contracts.ts`, `plugins/generative-ui/client/panel.tsx`

Host facts that constrain the design:

1. Surfaces get `theme`, `host: {id, label}`, `layout: {compact, platform}` and an optional `navigation`. They do not get `openSettings`. The surface reaches settings through the `PluginClientContext` closure (`client.openSettings("obsidian")`, declared on `PluginCommandCapabilities`).
2. `PluginSidebarItemContribution` is `{id, title, Component}`; the item renders its own row with `SidebarRow`. It has no badge or status field. The sidebar cannot show sync health.
3. `SettingsState.values` is returned to the client. Anything in the settings document is visible to the UI. The auth token therefore cannot be a settings field.
4. `PluginAttachmentSourceContribution` takes `title`, `icon`, `pickerTitle`, `searchPlaceholder` and `search`. These are static registration strings. The host calls `search` with `{ query }` only. The result is parsed with `$strip`, so unknown fields are dropped. The host owns the trigger character and the picker chrome.
5. Item `url` is validated as `z.url()`. `openExternalUrl` accepts only absolute HTTP(S) URLs (`client/index.d.ts`), so the plugin cannot open `obsidian://` through it.
6. `PluginTheme.colors` has eleven tokens: `surface0`, `surface1`, `surface2`, `border`, `foreground`, `foregroundMuted`, `accent`, `accentForeground`, `statusSuccess`, `statusWarning`, `statusDanger`. There is no `ring` and no `background`. `PluginThemeColors` (`background`, `raised`, `control`, `mutedForeground`, `ring`) belongs to `addTheme` only, which this plugin does not use.
7. `ToastApi` offers `show` and `error`. `Modal` takes `title`, `open`, `onOpenChange`, and `Content` with `scrollable`. `copyText` is available for copying paths and URLs.
8. Server hooks can set `systemPrompt` and `mcpServers` on `agent.create` (`server/lifecycle.d.ts`, `server/provider.d.ts`). Whether a running agent picks up a changed prompt was not verified; see open question 9.

## Surface inventory

Contribution points used:

| Surface                    | Purpose                                                                          | Host API                                                                                                                                                                                      | Why this and not the alternatives                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Global screen `vault`      | Sync health, injection status, read-only browser of the vault, setup entry point | `addScreen({ id: "vault", title: "Obsidian vault", Component })` (`client/contracts.d.ts`)                                                                                                    | Vault is one per daemon, not per workspace or agent. Workspace panels require `workspaceId` or `agentId` context.                       |
| Sidebar item `vault`       | Entry point to the screen                                                        | `addSidebarHeaderItem({ id: "vault", title: "Obsidian vault", Component: VaultSidebarItem })`; the item renders `SidebarRow` (`client/ui.d.ts`) and calls `openScreen({ screenId: "vault" })` | Only global entry point. The item cannot show status (no badge field), so health appears only on the screen and in the settings screen. |
| Settings screen `obsidian` | Setup: token, `ob` path, vault choice, Sync now, injection status                | `addSettingsScreen({ id: "obsidian", title: "Obsidian vault", icon: "Settings", Component })` plus `useSettings(settingsDefinition)` for host-scoped non-secret values                        | Setup belongs where the host keeps its other host-level configuration. The surface stays read-mostly.                                   |
| Attachment source `vault`  | User attaches a vault note to a message                                          | `addAttachmentSource({ id: "vault", title, icon, pickerTitle, searchPlaceholder, search })`                                                                                                   | The host's composer picker is the only attachment affordance. No composer pill, no slash command.                                       |

Confirmation dialogs use the host `Modal` primitive from `client/react-native.d.ts`. This is a UI primitive, not a contribution point.

Server contributions (not UI, listed for the mapping section): `registerSettings`, `handle` for each RPC contract, and `before("agent.create")` to append the injected prompt and register the vault MCP server.

Deliberately not used:

| Contribution                                                                              | Reason for not using it                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `addWorkspacePanel`                                                                       | Panel contexts are `workspace` or `agent` (`client/contracts.d.ts`). The vault is daemon-global, so a per-workspace panel would repeat the same data.                                                                                                  |
| `addComposerPill`                                                                         | Per-agent button in the composer. It would repeat sync status on every agent and cannot carry a browser.                                                                                                                                               |
| `addHeaderButton`                                                                         | Workspace-scoped. Wrong scope for a daemon-global vault.                                                                                                                                                                                               |
| `addSlashCommand`                                                                         | Out of scope by decision.                                                                                                                                                                                                                              |
| `addCommandCenterItem`                                                                    | Out of scope by decision.                                                                                                                                                                                                                              |
| `addTimelineRenderer`, `addTimelineTransformer`                                           | v0 has no agent write events to render. Read events are not shown in the timeline.                                                                                                                                                                     |
| `addTheme`                                                                                | This plugin consumes the host theme. Contributing a theme would restyle the whole app.                                                                                                                                                                 |
| `openPanel`, `navigation.openAgent`, `navigation.openWorkspace`, `navigation.openBrowser` | No panels, no agent or workspace links in v0.                                                                                                                                                                                                          |
| `openExternalUrl`, `ExternalLink` for `obsidian://`                                       | `openExternalUrl` is documented as HTTP(S) only (`client/index.d.ts`). `ExternalLink.href` is typed `string` (`client/ui.d.ts`); scheme support was not verified, so this design does not rely on it. Use `copyText` on the `obsidian://` URL instead. |
| `useHosts`                                                                                | Optional. Used only for the "host offline" line when the daemon is not connected.                                                                                                                                                                      |

## Information architecture

What the user must be able to see:

| Item                                     | Where shown                                          | Source field                                                        |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Sync token stored? and for which account | Settings, Connection; surface header line            | `token.stored`, `token.account`                                     |
| `ob` found, where, and its version       | Settings, Obsidian CLI; checklist                    | `ob.path`, `ob.source`, `ob.version`, `ob.minVersion`               |
| Which vault                              | Surface header; Settings, Vault                      | `vault.name`                                                        |
| Sync state (one of five)                 | Surface status row; settings status row              | `state`                                                             |
| Currently pulling (independent of state) | Surface and settings, as "Syncing..."                | `pulling`                                                           |
| Last successful sync                     | Surface; settings                                    | `lastSuccessAt`                                                     |
| Stale threshold (15 min)                 | Derived from `lastSuccessAt` and `staleAfterSeconds` | `staleAfterSeconds`                                                 |
| Error code and repair                    | Banner on surface and settings                       | `error.code`, `error.repair`                                        |
| Read-only label                          | Always on the surface                                | Static; no field                                                    |
| What agents can do                       | Surface, Agent tools line                            | Static list: `list_vault`, `glob_vault`, `grep_vault`, `read_vault` |
| Injected prompt and skills               | Surface, Agent instructions section; settings        | `injection.systemPrompt`, `injection.skills`                        |
| Vault file browser                       | Surface                                              | `vault.list`, `vault.read`                                          |

Not in v0: recent agent writes (no write tools), agent read log (no event stream), permission prompts (no approvals, see Interaction detail).

## Screen and panel specs

Common rules:

- Wide: padding 24, section gap 12, card padding 16.
- Compact (`layout.compact === true`): padding 12, single column, every control at least 44 pt tall.
- Visible text is plain. Note bodies are shown as plain selectable text, not rendered Markdown.
- Paths use the monospace face from `plugins/devenv/client/ui.tsx` (`Menlo` on iOS, `monospace` elsewhere).

### 1. Global surface, wide

```
+------------------------------------------------------------------------+
| Obsidian vault                                         Host: laptop-01 |
|                                                                        |
| [ Up to date ]   Read-only                              [ Open settings ] |
| Vault           Work notes                                             |
| Last sync       2 min ago                                              |
| Agent tools     list_vault, glob_vault, grep_vault, read_vault         |
|                                                                        |
| AGENT INSTRUCTIONS                                                     |
|   .paseo/system.md          Injected                         4.2 KB    |
|   .paseo/skills/*.md        3 injected                                 |
|   Applies to new agents only.                                          |
|                                                                        |
| VAULT FILES                                       Work notes / Projects |
|   [folder]  2026                                                       |
|   [file]    Roadmap.md                       12.4 KB   Oct 12, 09:14    |
|   [file]    Q4 review.md                      3.1 KB   Oct 10, 17:02    |
+------------------------------------------------------------------------+
```

The "Open settings" button lives in the status row. Browser rows are full width. The breadcrumb sits right-aligned in the browser header. A folder row opens that folder. A file row opens the note reader.

### 2. Global surface, compact

```
+--------------------------------------+
| Obsidian vault                       |
| Host: laptop-01                      |
| [ Up to date ]  Read-only            |
| Vault       Work notes               |
| Last sync   2 min ago                |
| Agent tools list_vault, glob_vault,  |
|             grep_vault, read_vault   |
| [         Open settings          ]   |
|                                      |
| AGENT INSTRUCTIONS                   |
| .paseo/system.md     Injected 4.2 KB |
| .paseo/skills/*.md   3 injected      |
| Applies to new agents only.          |
|                                      |
| VAULT FILES                          |
| Work notes / Projects         [Up]   |
| [folder] 2026                    >   |
| [file]   Roadmap.md              >   |
+--------------------------------------+
```

Note reader in compact (pushed over the browser):

```
+--------------------------------------+
| < Back                               |
| Projects/Roadmap.md                  |
| 12.4 KB, modified Oct 12, 09:14      |
| [          Copy path            ]    |
| ------------------------------------ |
| # Roadmap                            |
| Q4 targets ...                       |
|                                      |
| Showing first 64 KB of 96 KB.        |
+--------------------------------------+
```

"Back" returns to the same folder. The copy action copies the vault-relative path with `copyText`. The compact surface has no breadcrumb row beyond the current folder name and an "Up" action.

### 3. Settings screen, wide

```
+------------------------------------------------------------------------+
| Obsidian vault                                                         |
|                                                                        |
| Sync state     [ Up to date ]    Last successful sync 2 min ago        |
|                                                                        |
| CONNECTION                                                             |
|   Sync token                                   Stored for ana@...      |
|   [ Paste sync token ____________________________ ] [ Save token ]     |
|   Saved tokens are never shown again.                                  |
|   [ Remove token ]                                                     |
|                                                                        |
| OBSIDIAN CLI (ob)                                                      |
|   ob path                                      Found on PATH           |
|   [ Empty uses ob from PATH _________________ ]                        |
|                                                                        |
| VAULT                                                                  |
|   Remote vault      [ Work notes                              v ]      |
|   Sync pulls this vault into the daemon's local copy.                  |
|   Read-only. This plugin never changes notes.                          |
|   [ Sync now ]                                                         |
|                                                                        |
| AGENT INSTRUCTIONS                                                     |
|   .paseo/system.md             Injected                  4.2 KB        |
|   .paseo/skills/*.md           3 injected                              |
+------------------------------------------------------------------------+
```

Settings uses `SettingsSection` per group, `SettingsCard` for each block, `SettingsRow` for read-only labels, `SettingsInput` (token with `secureTextEntry`, `ob` path), `SettingsSelect` (remote vault), and `SettingsAction` for Sync now and Remove token.

### 4. Settings screen, compact

```
+--------------------------------------+
| Obsidian vault                       |
| Sync state  [ Up to date ]           |
| Last successful sync 2 min ago       |
|                                      |
| CONNECTION                           |
| Sync token       Stored for ana@...  |
| [ Paste sync token           ]       |
| [          Save token          ]     |
| [          Remove token        ]     |
| Saved tokens are never shown again.  |
|                                      |
| OBSIDIAN CLI (ob)                    |
| ob path     Found on PATH            |
| [ Empty uses ob from PATH    ]       |
|                                      |
| VAULT                                |
| Remote vault                         |
| [ Work notes                  v ]    |
| Read-only. This plugin never         |
| changes notes.                       |
| [          Sync now            ]     |
|                                      |
| AGENT INSTRUCTIONS                   |
| .paseo/system.md   Injected 4.2 KB   |
| .paseo/skills/*.md 3 injected        |
+--------------------------------------+
```

In compact, every control stacks vertically. Buttons are full width. Sections keep their headings. Error banners appear at the top of the section they affect, not in a separate panel.

### 5. Error banner (surface and settings)

Shown when `state === "error"`. Other states show no banner, except stale, which uses a warning banner.

```
+--------------------------------------+
| ! Sync error                         |
| The Obsidian CLI (ob) is not on      |
| PATH. Install it or set its path     |
| in settings.                         |
| Last successful sync 3 h ago.        |
| [ Open settings ]                    |
+--------------------------------------+
```

The banner has a left rule in the tone colour, the title, and the body. Its only action on the surface is "Open settings" (`action.openSettings`). The repair listed in the error table (for example "Set ob path" or "Retry sync") is performed in settings, where the Sync now control and the ob path field live.

### 6. Attachment picker flow

The host owns the trigger character, the source chooser, the search field chrome, row layout and the empty state. The plugin supplies only the registration strings and item fields.

Step 1: host attach menu shows the source `Obsidian vault` (plugin `title`, `icon`).

Step 2: host picker opens with `pickerTitle` and `searchPlaceholder`:

```
+--------------------------------------+
| Obsidian note                    x   |
| [ Search notes by name or path ]     |
|--------------------------------------|
| Inbox                                |
|   Daily                              |
| Project plan                         |
|   Projects/2026                      |
+--------------------------------------+
```

Row content comes from `title` (note name without `.md`) and `subtitle` (parent folder, or "Vault root"). The row layout is host-rendered; the plugin does not declare how title and subtitle are styled. Results are at most 50 items, sorted by note name.

Step 3: the user selects a row. The host attaches the item's `text`, which is the header `<Projects/2026/Project plan.md>` followed by a snapshot of at most 8 KB. The snapshot is not previewed in the picker; the host decides whether the attachment shows a chip, and what that chip says.

If the vault is not ready, `search` returns `{ items: [] }` and the host shows its own empty state. The plugin cannot put an explanation there. The surface explains readiness.

### 7. Confirmation dialog (remove token)

```
+------------------------------------+
| Remove sync token?             [x] |
|                                    |
| Sync stops. The local copy of      |
| Work notes is deleted. Agents lose |
| vault tools and the attachment     |
| source until a token and a vault   |
| are set again.                     |
|                                    |
|          [ Cancel ]  [ Remove ]    |
+------------------------------------+
```

"Remove" uses the danger tone (`statusDanger`). "Cancel" is the default focus.

### 8. Note-path copy and host offline

When `useHosts()` reports the host status as `offline` or `error`, the surface shows a line above the status row: `Host laptop-01 is offline. The state below was read before it disconnected.` The status row is still rendered from the last snapshot and is marked as not live.

## State matrix

Sync state is computed on the daemon with this precedence:

1. `unconfigured`: no token, or no vault selected.
2. `error`: token and vault set, and one of the seven error codes applies.
3. `starting`: running, no successful sync yet.
4. `stale`: running, and `lastSuccessAt` is older than 15 minutes.
5. `watching`: running and up to date.

`pulling` is an independent flag. It is true while a Sync now request or an automatic pull is in flight.

| State / trigger                                          | Shown                                                                                               | Disabled                                                    | Next action for the user (retry and sync are in settings) |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| Never logged in (`unconfigured`, no token)               | "Not set up". Checklist: step 1 todo. Browser shows "Set up the vault in settings to browse notes." | Sync now, vault select, browser                             | "Set up vault" (opens settings)                           |
| Token stored, no vault (`unconfigured`)                  | Checklist: step 1 done, step 3 todo                                                                 | Sync now, browser                                           | "Choose vault" in settings                                |
| Token and vault, `ob` missing (`error: ob_missing`)      | Error banner. Checklist shows ob row as "Not found on PATH"                                         | Browser shows last copy if any                              | "Set ob path" (focuses field), "Retry sync"               |
| `ob` too old (`error: ob_too_old`)                       | Error banner with `ob` version and minimum                                                          | Browser keeps last copy                                     | Update ob, then "Retry sync"                              |
| Token removed while sync runs                            | Sync stops. Checklist returns to step 1. Browser shows the same "Set up" text as never logged in    | Sync now, vault select, browser actions that need the vault | Replace token in settings                                 |
| Logging in, token being verified                         | Save token button shows "Saving..." and disables input                                              | Save, Remove token                                          | Wait. Result shows as toast                               |
| Login failed (`error: token_invalid` on save)            | Toast: "Token rejected. Nothing was saved." Field keeps its text until the next save                | Nothing                                                     | Paste a new token                                         |
| Credentials revoked (`error: token_invalid` during sync) | Error banner. Browser keeps last copy, marked "Last copy"                                           | Sync now disabled until a token is replaced                 | "Replace token"                                           |
| Starting (`starting`)                                    | "Starting sync...". Browser shows "Waiting for the first sync."                                     | Browser actions that need content                           | None; state changes automatically                         |
| Up to date (`watching`)                                  | "Up to date". Last sync time                                                                        | None                                                        | None                                                      |
| Syncing (`watching` with `pulling: true`)                | "Up to date" plus "Syncing..."                                                                      | Sync now                                                    | None                                                      |
| Stale (`stale`)                                          | Warning banner: "Out of date. Last successful sync {relative}. Agents read the last copy."          | None                                                        | "Retry sync"                                              |
| Conflict                                                 | Not in v0. Vault is read-only and the client never uploads, so no local edit can conflict.          | Not applicable                                              | Not applicable                                            |
| Sync error, generic (`error: sync_failed`)               | Error banner with sanitised message                                                                 | Browser keeps last copy                                     | "Retry sync"                                              |
| Remote unreachable (`error: remote_unreachable`)         | Error banner: retrying automatically; last copy readable                                            | None                                                        | "Retry sync"                                              |
| Lock held (`error: lock_held`)                           | Error banner. Does not offer to remove the lock                                                     | None                                                        | Stop the other process, then "Retry sync"                 |
| Vault deleted or moved (`error: vault_missing`)          | Error banner names the vault. Settings select shows old name marked "Not found"                     | Sync now                                                    | "Choose vault"                                            |
| Vault moved within the same account                      | No state change: the vault id is unchanged, so sync continues                                       | None                                                        | None                                                      |
| Read-only                                                | Always shown as "Read-only" label on the surface and in settings. No toggle exists.                 | Not applicable                                              | Not applicable                                            |
| Host offline (client disconnected)                       | Offline line above status row. Last snapshot marked not live                                        | Sync now, settings edits                                    | Reconnect to the host                                     |
| Status read failed (RPC error)                           | Inline line: "Could not read vault status from {host}." Status row shows "Unknown"                  | Sync now, token actions                                     | "Retry"                                                   |
| Settings loading                                         | Skeleton rows                                                                                       | All inputs                                                  | None                                                      |
| Settings error (`useSettings` status `error`)            | "Settings could not be read: {error}"                                                               | All inputs                                                  | "Reload" (calls `reload()`)                               |
| Settings invalid (`useSettings` status `invalid`)        | "Settings are invalid: {error}"                                                                     | All inputs except Reset                                     | "Reset settings" (confirmation)                           |
| Recovered (`error` to `watching`)                        | Banner clears. Toast: "Sync recovered. Up to date."                                                 | None                                                        | None                                                      |

Transitions: `unconfigured` to `starting` when token, vault and `ob` are all valid. `starting` to `watching` on first success. `watching` to `stale` after 15 minutes without success. Any state to `error` on a code. `error` to `starting` on retry, or to `watching` on the next success. `stale` to `watching` on the next success. Errors do not clear the browser's last copy.

Note on token precedence: when `ob` is missing and no token is stored, the state is `unconfigured`. The `ob` problem is shown as a checklist warning, not as an error banner, so that the first-run checklist is the single source of guidance.

## Interaction detail

First run (no token, no `ob`, no vault):

1. The user opens the vault sidebar item. The surface shows "Not set up" and a checklist:
   - "1 Sync token" (todo)
   - "2 Obsidian CLI" (todo, or "Not found on PATH" warn)
   - "3 Vault" (todo)
   - "4 First sync" (todo)
2. "Set up vault" opens the settings screen via `client.openSettings("obsidian")`.
3. The user pastes a token and presses "Save token". The field is cleared on success (`SettingsInputHandle.replaceText("")`). The token is validated on save, not on paste. Success shows "Token saved for {account}." A rejected token shows "Token rejected. Nothing was saved." A token that cannot be checked shows the failing code's title followed by "Nothing was saved.", because the sync error bodies describe a sync that has not started yet.
4. The remote vault select loads after a token is saved. The user chooses a vault. A first selection needs no confirmation.
5. Choosing a vault starts sync automatically. The state becomes `starting`.
6. If `ob` is missing at that point, the state becomes `error: ob_missing`. The user opens settings, sets the ob path or installs `ob`, then presses "Retry sync" in settings.

Token replacement: "Replace token" focuses the token field and changes the save button label to "Replace token". Saving a new valid token does not interrupt sync if the vault is unchanged.

Failed save: the host answers a save whose revision no longer matches the document with a `conflict` result carrying its own message. The screen shows that message through `settings.saveError` and reloads the document afterwards, so a client that read the settings before another client wrote them recovers the current values instead of retrying against a stale revision.

Stale data: the stale banner on the surface names the age of the last successful sync and says that agents read the last copy. The surface offers no sync control; "Retry sync" appears in settings only.

Recovered sync: when state moves from `error` or `stale` to `watching`, the banner clears and a toast reads "Sync recovered. Up to date." The live region announces the change politely.

Read-only confirmation: none. There is no mode to switch.

Permission and approval surfaces: none. v0 has no writes, so there is nothing to approve in the plugin. Tool access for agents is governed by Paseo's existing agent permissions. This document does not design those.

Empty states:

- No vault selected: "No vault selected. Choose a vault in settings to start syncing."
- Synced vault with zero notes: "Empty vault. Add notes in Obsidian, then wait for the next sync."
- Empty folder: "This folder is empty."
- Picker with no results: host-rendered empty state. The plugin supplies no text for it.

Error states in content:

- `path_denied`: "This path is excluded from vault access."
- `binary_file`: "Binary file. Preview not available."
- `not_found`: "This file is no longer in the vault. Go back to refresh the folder."
- `vault_unavailable`: "The vault is not available. See the status above."
- Truncated listing: "Showing first {n} entries. Open a folder to narrow the list."
- Truncated note: "Showing first {n} KB of {total} KB."

Destructive actions and their copy:

- Remove token: confirmation (see screen 7). Result: sync stops, the local copy is deleted, vault tools and the picker source stop working until setup is repeated. Removing a token is not reversible without pasting the token again.
- Switch vault (choosing a different vault after one is set): confirmation. Body: "The local copy of {old} is replaced by {new}. Sync pulls {new} from the start." Actions: "Switch vault" (accent) and "Cancel".
- Reset settings: confirmation. Body: "Clears the ob path and the selected vault. The sync token is kept." Actions: "Reset settings" (danger) and "Cancel".

## Copy deck

Strings are English only in v0. Store them in one module so they can be localised later. Relative times are formatted as "Just now" (under 1 minute), "{n} min ago" (under 60 minutes), "{n} h ago" (under 24 hours), otherwise a date `Mon D, HH:mm`. Localisation of these formats is open (see questions).

Surface:

| Key                       | String                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------- |
| surface.title             | Obsidian vault                                                                      |
| surface.host              | Host: {host.label}                                                                  |
| state.unconfigured        | Not set up                                                                          |
| state.starting            | Starting sync                                                                       |
| state.watching            | Up to date                                                                          |
| state.stale               | Out of date                                                                         |
| state.error               | Sync error                                                                          |
| state.pulling             | Syncing                                                                             |
| readonly.label            | Read-only                                                                           |
| readonly.line             | Read-only. Agents can list, search and read notes. Nothing is written to the vault. |
| tools.line                | Agent tools: list_vault, glob_vault, grep_vault, read_vault                         |
| lastSync.label            | Last sync                                                                           |
| lastSync.never            | Never synced                                                                        |
| vault.label               | Vault                                                                               |
| stale.banner              | Out of date. Last successful sync {relative}. Agents read the last copy.            |
| offline.line              | Host {host.label} is offline. The state below was read before it disconnected.      |
| statusRead.error          | Could not read vault status from {host.label}.                                      |
| action.openSettings       | Open settings                                                                       |
| action.setUp              | Set up vault                                                                        |
| action.retry              | Retry sync                                                                          |
| action.back               | Back                                                                                |
| action.copyPath           | Copy path                                                                           |
| action.up                 | Up                                                                                  |
| agentInstructions.heading | AGENT INSTRUCTIONS                                                                  |
| injection.injected        | Injected                                                                            |
| injection.notInjected     | Not injected. Create {path}.                                                        |
| injection.truncated       | Truncated at {limit} KB. Shorten the file.                                          |
| skills.injected           | {n} injected                                                                        |
| skills.none               | No skills in .paseo/skills/                                                         |
| injection.newAgents       | Applies to new agents only.                                                         |
| browser.heading           | VAULT FILES                                                                         |
| browser.empty             | Empty vault. Add notes in Obsidian, then wait for the next sync.                    |
| browser.folderEmpty       | This folder is empty.                                                               |
| browser.truncatedList     | Showing first {n} entries. Open a folder to narrow the list.                        |
| browser.truncatedNote     | Showing first {n} KB of {total} KB.                                                 |
| browser.pathDenied        | This path is excluded from vault access.                                            |
| browser.binary            | Binary file. Preview not available.                                                 |
| browser.notFound          | This file is no longer in the vault. Go back to refresh the folder.                 |
| browser.unavailable       | The vault is not available. See the status above.                                   |
| browser.waiting           | Waiting for the first sync.                                                         |
| browser.lastCopy          | Last copy                                                                           |

Settings:

| Key                      | String                                              |
| ------------------------ | --------------------------------------------------- |
| settings.title           | Obsidian vault                                      |
| section.connection       | CONNECTION                                          |
| section.cli              | OBSIDIAN CLI (ob)                                   |
| section.vault            | VAULT                                               |
| section.instructions     | AGENT INSTRUCTIONS                                  |
| section.status           | SYNC STATUS                                         |
| token.label              | Sync token                                          |
| token.stored             | Stored for {account}                                |
| token.storedNoAccount    | Token stored                                        |
| token.none               | No token stored                                     |
| token.placeholder        | Paste sync token                                    |
| token.hint               | Saved tokens are never shown again.                 |
| token.replaceHint        | Paste a new token to replace the stored one.        |
| action.saveToken         | Save token                                          |
| action.replaceToken      | Replace token                                       |
| action.removeToken       | Remove token                                        |
| action.saving            | Saving...                                           |
| cli.label                | ob path                                             |
| cli.foundPath            | Found on PATH: {path}                               |
| cli.notFound             | Not found on PATH                                   |
| cli.placeholder          | Empty uses ob from PATH                             |
| cli.hint                 | Set this only if ob is not on PATH.                 |
| vault.select             | Remote vault                                        |
| vault.placeholder        | Choose a vault                                      |
| vault.hint               | Sync pulls this vault into the daemon's local copy. |
| vault.readonly           | Read-only. This plugin never changes notes.         |
| vault.notFound           | Not found                                           |
| action.syncNow           | Sync now                                            |
| action.setVaultSwitch    | Switch vault                                        |
| action.reset             | Reset settings                                      |
| action.reload            | Reload                                              |
| settings.readError       | Settings could not be read: {error}                 |
| settings.invalid         | Settings are invalid: {error}                       |
| settings.saved           | Settings saved.                                     |
| settings.saveError       | Settings could not be saved: {error}                |
| instructions.hint        | Applies to new agents only.                         |
| instructions.injected    | Injected                                            |
| instructions.notInjected | Not injected. Expected {path}                       |

Error banners (`error.code`: title / body / action). The Action column is the repair performed in settings. The surface banner shows only "Open settings" and links there.

| Code               | Title                     | Body                                                                                         | Action        |
| ------------------ | ------------------------- | -------------------------------------------------------------------------------------------- | ------------- |
| ob_missing         | ob not found              | The Obsidian CLI (ob) is not on PATH. Install it, or set its path below.                     | Set ob path   |
| ob_too_old         | ob is too old             | ob {version} is installed. Version {minVersion} or later is required. Update ob, then retry. | Retry sync    |
| token_invalid      | Token rejected            | Obsidian rejected the sync token. It may be expired or revoked.                              | Replace token |
| vault_missing      | Vault not found           | {vaultName} is not available to this token. It may have been deleted or moved.               | Choose vault  |
| remote_unreachable | Obsidian Sync unreachable | Could not reach Obsidian Sync from {host.label}. Retrying. The last copy stays readable.     | Retry sync    |
| lock_held          | Vault is locked           | Another sync process holds the lock for this vault. Stop it, then retry.                     | Retry sync    |
| sync_failed        | Sync failed               | The last sync failed: {message}                                                              | Retry sync    |

Toasts:

| Key                       | String                             |
| ------------------------- | ---------------------------------- |
| toast.tokenSaved          | Token saved for {account}.         |
| toast.tokenSavedNoAccount | Token saved.                       |
| toast.tokenRejected       | Token rejected. Nothing was saved. |
| toast.tokenUnverified     | {reason}. Nothing was saved.       |
| toast.syncStarted         | Sync started.                      |
| toast.syncBusy            | Sync is already running.           |
| toast.syncRecovered       | Sync recovered. Up to date.        |
| toast.syncFailedToStart   | Could not start sync: {message}    |

Confirmations:

| Key                 | Title              | Body                                                                                                                                             | Actions                                   |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| confirm.removeToken | Remove sync token? | Sync stops. The local copy of {vaultName} is deleted. Agents lose vault tools and the attachment source until a token and a vault are set again. | Cancel (default), Remove token (danger)   |
| confirm.switchVault | Switch vault?      | The local copy of {oldName} is replaced by {newName}. Sync pulls {newName} from the start.                                                       | Cancel (default), Switch vault            |
| confirm.reset       | Reset settings?    | Clears the ob path and the selected vault. The sync token is kept.                                                                               | Cancel (default), Reset settings (danger) |

Attachment source (registration strings, static):

| Field             | String                       |
| ----------------- | ---------------------------- |
| title             | Obsidian vault               |
| pickerTitle       | Obsidian note                |
| searchPlaceholder | Search notes by name or path |

## Visual direction

Use only the eleven host tokens from `PluginTheme.colors`. Do not hardcode brand colours. Do not use `ring`, `background`, `raised`, `control`, `mutedForeground`: they do not exist in `PluginTheme`.

| Role                                                           | Token              |
| -------------------------------------------------------------- | ------------------ |
| Surface background                                             | `surface0`         |
| Cards, banners, input backgrounds                              | `surface1`         |
| Pressed or nested rows                                         | `surface2`         |
| Dividers, card outlines, input outlines                        | `border`           |
| Primary text                                                   | `foreground`       |
| Secondary text, hints, metadata                                | `foregroundMuted`  |
| Primary button background, focus outline, Syncing indicator    | `accent`           |
| Text on primary button                                         | `accentForeground` |
| Up to date                                                     | `statusSuccess`    |
| Stale, and Read-only warning rule when read-write exists later | `statusWarning`    |
| Sync error, Remove token                                       | `statusDanger`     |
| Not set up (unconfigured)                                      | `foregroundMuted`  |

Status palette rules:

- Every status pairs a colour with a text label. Colour is never the only signal.
- Status shows as a 7 pt dot plus the text label, the same construction as `plugins/devenv/client/status-icon.tsx`.
- Stale uses `statusWarning`. Error uses `statusDanger`. Starting and Syncing use `accent`.
- Read-only uses `foregroundMuted` with a `border` outline. It is a fact label, not a warning, so it does not use a status colour.

Hierarchy and spacing:

- Surface title 18, weight 600, `foreground`.
- Section label 12, weight 600, uppercase, `foregroundMuted`, letter spacing kept at default.
- Body 14, line height 20, `foreground`.
- Hints and metadata 12, line height 17, `foregroundMuted`.
- Paths 12 monospace, `foregroundMuted`, selectable.
- Cards use `surface1`, a 1 pt `border`, radius 8, padding 16 wide and 12 compact.
- Section gap 12. Row gap 8. Label-to-value gap 12.

Focus indicator (web): 2 pt outline in `accent`, offset 2. No ring token exists.

## Accessibility and mobile

Hit targets: every button, list row, select and input is at least 44 pt tall when `layout.compact` is true or `layout.platform !== "web"`. Otherwise 36 pt is the minimum, matching the rule used in `plugins/devenv/client/ui.tsx`.

Labels:

- Every `Pressable` has `accessibilityRole="button"` and an explicit `accessibilityLabel` that includes the object: "Sync now, Work notes", not "Sync now".
- Status rows have `accessibilityLabel` equal to the full status sentence, for example "Sync state: Up to date, last sync 2 minutes ago".
- Browser rows state their type: "Folder Projects" or "File Roadmap.md, 12.4 KB".
- Error banners use `accessibilityRole="alert"` only for `statusDanger` errors. Stale and recovery use `accessibilityLiveRegion="polite"`, matching `plugins/devenv/client/ui.tsx`.
- The token field has `accessibilityLabel="Sync token"` and `secureTextEntry`. The `ob` path field is labelled by its visible label.

Contrast:

- The host supplies the palette, so contrast is not guaranteed. Test every pair on both `appearance` values before shipping: `foreground` on `surface0` and `surface1`; `foregroundMuted` on `surface1` for 12 pt hints; `statusWarning` and `statusDanger` on `surface1`; `accentForeground` on `accent`.
- Do not use `foregroundMuted` as the only indicator of anything.

Compact (`layout.compact === true`):

- Single column. Sections stack. Buttons are full width.
- The browser pushes a note reader over the list with a Back action. There is no split view.
- Header actions wrap onto a second line rather than truncating.
- Monospace paths wrap; they never truncate in the middle without a visible affordance.

Keyboard versus touch (`layout.platform`):

- `web`: keyboard is the likely input. Tab order follows visual order. Enter and Space activate rows and buttons. The focus outline is required (see above).
- `ios` and `android`: touch only. No hover-only affordances. Long-press is not used because it is not discoverable.
- No keyboard shortcuts in v0.

## Implementation mapping

| Design element                                         | Host API                                                                                                                                                                          | RPC / contract shape                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Surface container                                      | `addScreen({ id: "vault", title: "Obsidian vault", Component })`                                                                                                                  | Props: `PluginScreenProps` (theme, host, layout, params)                                                              |
| Sidebar entry                                          | `addSidebarHeaderItem({ id: "vault", title: "Obsidian vault", Component: VaultSidebarItem })`; `SidebarRow` from `client/ui`                                                      | `PluginSidebarItemProps` (`currentScreen`, `openScreen`, `openPopover`)                                               |
| Open settings from surface                             | `client.openSettings("obsidian")` via closure over `PluginClientContext`                                                                                                          | Static                                                                                                                |
| Settings screen                                        | `addSettingsScreen({ id: "obsidian", ... })`                                                                                                                                      | `PluginSurfaceProps`                                                                                                  |
| Non-secret settings (`obPath`, `vaultId`, `vaultName`) | `useSettings(settingsDefinition)` for the document; `useRpc(settingsRpc(id).write)` for saves, since `SettingsState.save` returns a boolean and drops the host's conflict message | `SettingsState<typeof settingsSchema>`                                                                                |
| Token entry, replace, remove                           | `useRpc(tokenSetRpc)`, `useRpc(tokenClearRpc)`                                                                                                                                    | See below. Token is not in settings values.                                                                           |
| Sync status row, banners, checklist                    | `useRpc(statusRpc)` polled: 1500 ms while `state` is `starting`, 5000 ms otherwise (mirrors `plugins/devenv/client/status.tsx`)                                                   | `VaultStatus`                                                                                                         |
| Remote vault list                                      | `useRpc(remotesRpc)`                                                                                                                                                              | See below                                                                                                             |
| Sync now                                               | `useRpc(syncNowRpc)`                                                                                                                                                              | See below                                                                                                             |
| Vault browser folder                                   | `useRpc(listRpc)`                                                                                                                                                                 | `{ path }` in, discriminated union out                                                                                |
| Note reader                                            | `useRpc(readRpc)`                                                                                                                                                                 | `{ path }` in, discriminated union out                                                                                |
| Copy path                                              | `copyText` from `client/react-native`                                                                                                                                             | Static                                                                                                                |
| Attachment source                                      | `addAttachmentSource({ ... search: searchRpc })`                                                                                                                                  | `{ query }` in, `PluginAttachmentSearchPayload` out                                                                   |
| Injection status                                       | Part of `VaultStatus.injection`                                                                                                                                                   | Server inlines `.paseo/system.md` and indexes `.paseo/skills/*.md` by front matter; bodies are read with `read_vault` |
| Vault tools for agents                                 | `before("agent.create")`: append `systemPrompt`; add `mcpServers.obsidian`                                                                                                        | `ProviderMcpServerConfig` (stdio or http)                                                                             |
| Confirmations                                          | `Modal` from `client/react-native`                                                                                                                                                | Static                                                                                                                |
| Toasts                                                 | `useToast().show` and `.error`                                                                                                                                                    | Static                                                                                                                |
| Host label and offline line                            | `props.host.label`; `useHosts()`                                                                                                                                                  | `PluginHostSummary.status`                                                                                            |
| Settings registration (server)                         | `server.registerSettings(settingsDefinition)`                                                                                                                                     | `PluginSettings` (read, subscribe)                                                                                    |

Settings document (`settingsDefinition`, id `obsidian`, scope `host`, version 1):

```ts
type ObsidianSettings = {
  obPath: string;
  vaultId: string | null;
  vaultName: string | null;
};
```

Defaults: `obPath: ""`, `vaultId: null`, `vaultName: null`. `obPath` empty means PATH lookup. Changes to `vaultId` and `obPath` apply to sync on settings subscribe.

Status shape (`statusRpc` output):

```ts
type SyncState = "unconfigured" | "starting" | "watching" | "stale" | "error";
type SyncErrorCode =
  | "ob_missing"
  | "ob_too_old"
  | "token_invalid"
  | "vault_missing"
  | "remote_unreachable"
  | "lock_held"
  | "sync_failed";
type Repair = "replace_token" | "set_ob_path" | "choose_vault" | "retry";
type InjectionStatus = "injected" | "not_injected" | "truncated";

type InjectionFile = {
  path: string;
  status: InjectionStatus;
  bytes: number | null;
  modifiedAt: string | null;
};

type VaultStatus = {
  state: SyncState;
  pulling: boolean;
  error: { code: SyncErrorCode; repair: Repair; message: string | null } | null;
  token: { stored: boolean; account: string | null };
  ob: {
    path: string | null;
    source: "override" | "path" | null;
    version: string | null;
    minVersion: string;
  };
  vault: { id: string; name: string } | null;
  lastSuccessAt: string | null;
  staleAfterSeconds: 900;
  injection: { systemPrompt: InjectionFile; skills: InjectionFile[] };
};
```

`message` is set only for `sync_failed` and `remote_unreachable`, sanitised, and never contains the token. The client renders copy from `code`, not from `message`, except for the `sync_failed` body.

Token contracts (outside settings):

```ts
type TokenSetInput = { token: string };
type TokenSetOutput =
  | { status: "saved"; account: string | null }
  | { status: "rejected" }
  | { status: "error"; code: SyncErrorCode };
type TokenClearOutput = { status: "removed" };
```

Discriminated unions follow the status pattern in `<sdk>/settings.d.ts`, so failures are data, not thrown errors. Thrown-error propagation to the UI is not declared in the SDK, so this avoids depending on it.

Remote vaults and sync:

```ts
type RemotesOutput =
  | { status: "ok"; vaults: { id: string; name: string }[] }
  | { status: "token_missing" }
  | { status: "error"; code: SyncErrorCode };
type SyncNowOutput =
  | { status: "started" }
  | { status: "already_pulling" }
  | { status: "unconfigured" };
```

Vault browser and reader (shapes from the brief, plus the discriminant):

```ts
type ListInput = { path: string };
type ListOutput =
  | {
      status: "ok";
      entries: {
        path: string;
        name: string;
        type: "file" | "folder";
        size: number;
        modifiedAt: string;
      }[];
      truncated: boolean;
    }
  | {
      status: "error";
      code: "path_denied" | "not_found" | "vault_unavailable";
    };

type ReadInput = { path: string };
type ReadOutput =
  | {
      status: "ok";
      path: string;
      text: string;
      truncated: boolean;
      bytes: number;
      modifiedAt: string;
    }
  | {
      status: "error";
      code: "path_denied" | "binary_file" | "not_found" | "vault_unavailable";
    };
```

Attachment search (host calls with `{ query }` only):

```ts
type SearchInput = { query: string };
type SearchOutput = {
  items: {
    id: string;
    identifier: string;
    title: string;
    subtitle?: string;
    url: string;
    text: string;
    resourceType: "obsidian-note";
  }[];
};
```

Per item: `id` and `identifier` are the vault-relative path. `title` is the note name without `.md`. `subtitle` is the parent folder, or "Vault root". `url` is `obsidian://open?vault=<vaultName>&file=<encoded path>`. `text` is the header `<path>` followed by a snapshot of at most 8 KB, with a `[truncated]` line inside that budget if cut. Maximum 50 items, sorted by note name. When the vault is not ready, return `{ items: [] }` and do not throw.

Validation: `url` is `z.url()`. This must be confirmed to accept `obsidian://` in the planner's tests (see questions).

## Open UI questions

1. Are the icon names `Notebook` and `Settings` in the host's icon set? `PluginIconProps.name` is a plain `string` (`client/contracts.d.ts`) and no icon list is declared. Existing plugins use `Leaf` and `PanelsTopLeft`. Recommendation: confirm both names render on the running host before implementation; if not, pick any name the host renders.
2. Should the surface be able to run Sync now? The fixed contents put it in settings only, and the surface's error banner offers only the settings repair action. Recommendation: keep it in settings for v0. Adding a button later is one RPC call (`syncNowRpc`), so nothing is lost by waiting.
3. What does the picker show when `search` rejects? `searchPluginAttachments` propagates rejection, and the SDK does not declare how the host renders it. Recommendation: never reject; return `{ items: [] }` when the vault is not ready. The surface explains readiness.
4. Can the picker's static strings change with state? The contribution is registered once and `searchPlaceholder` is a plain string. Recommendation: keep static strings. Do not promise "vault not ready" text in the picker.
5. Empty query behaviour. Recommendation: an empty query returns the first 50 notes by name so the picker is usable for browsing. A minimum length would hide the note list entirely.
6. Picker truncation. The payload has no `truncated` field and the host strips unknown fields (`attachments.d.ts`, `$strip`). Recommendation: accept the 50-item cap silently for v0; raise a host request for a truncation signal if users report missing notes.
7. Remove token: delete the local copy, or keep it? Recommendation: delete it, with the confirmation in screen 7. Keeping a copy with no token means agents silently read data that can no longer be refreshed.
8. Error states serve the last copy. Recommendation: serve it, mark it "Last copy" on the surface, and add a `stale` flag to tool results so agents can say so. The tool-result flag is outside this design and needs its own decision.
9. Do running agents get the injected prompt and MCP server after a change? The hook is `before("agent.create")` (`server/lifecycle.d.ts`). Recommendation: state "Applies to new agents only" everywhere it is shown, and test the running-agent behaviour before relying on any stronger claim.
10. Injection size cap. Not specified. Recommendation: 32 KB per file, shown as "Truncated at 32 KB" when exceeded. Confirm before implementation.
11. Excluded paths. Recommendation: exclude `.obsidian/` and `.trash/` from `list_vault`, and return `path_denied` for direct reads of those prefixes. These are Obsidian internals and deleted notes; agents should not read them.
12. Token account label. The `ob` output that identifies the account is unknown. Recommendation: show "Token stored" when no account is available, and never show a guessed account.
13. Sync failure detail. Recommendation: show only the sanitised last message in `sync_failed`. No log viewer in v0.
14. Relative time and date formatting across locales. Recommendation: English only in v0; keep strings in one module.
15. Minimum `ob` version (`ob.minVersion`) and the remote vault listing command are not defined by the brief. The planner must set `minVersion` before the `ob_too_old` copy can be final.
16. `obsidian://` URLs. The item `url` is validated with `z.url()`; the planner must confirm this accepts a custom scheme. The surface does not offer "Open in Obsidian" because the host cannot open that scheme. Recommendation: copy the path or URL with `copyText`.
17. Vault scope. Recommendation: one vault per daemon, as the settings screen and surface are host-scoped. Multiple vaults later need a vault picker on the surface and a `vaultId` per attachment item.

## Deferred: read-write (not shipping)

This section describes a possible later change. None of it exists in v0.

- Where it would live: a host-scoped setting `access: "read-only" | "read-write"` on the settings screen, with the surface label switching to "Read-write" in `statusWarning`. The composer picker stays unchanged.
- What it must communicate before enabling: agents can create and change notes; changes sync to every device on the Obsidian account; Paseo cannot undo an agent edit; the change needs a confirmation with the consequences stated plainly.
- What it must not do: switch silently, or reuse the read-only copy for write confirmation.
- Requirements this would add: write tools, an upload path in `ob`, a conflict state, and a record of agent writes on the surface.
