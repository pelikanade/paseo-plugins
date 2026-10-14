# Paseo plugins

Terms for the `paseo-obsidian` plugin: how a vault reaches Paseo agents on the daemon host, and what the plugin promises about reading it.

## Language

**Vault**:
The Obsidian vault this plugin serves to agents, held as one directory on the daemon host. One vault exists per daemon.
_Avoid_: Knowledge base, notes folder, Obsidian instance

**Managed vault directory**:
The plugin-owned copy of the vault at `$PASEO_HOME/plugin-data/obsidian/vault`, used unless settings point the vault at an existing directory.
_Avoid_: Cache, mirror, clone, checkout

**Injection file**:
A file inside the vault whose text the plugin appends to an agent's system prompt. The convention is `.paseo/system.md` plus every `.paseo/skills/*.md`.
_Avoid_: Skill file, prompt file, context file, rules file

**Vault tool server**:
The stdio MCP server the plugin adds to an agent's session config at creation, exposing read-only list, glob, grep, and read operations over the vault.
_Avoid_: Obsidian MCP, notes server, plugin MCP

**Note reference**:
A composer attachment item that inserts a vault-relative path plus a truncated content snapshot into a chat message.
_Avoid_: `$` mention, @-mention, wikilink, embed, link

**Read-only mode**:
The state in which the vault tool server exposes no write operations and the plugin never pushes local changes to the remote vault. This is the only mode v0 ships.
_Avoid_: Locked, safe mode, viewer mode

**Staleness marker**:
`lastSyncedAt` and a stale flag attached to every tool result, describing how old the local copy is relative to the freshness threshold.
_Avoid_: Sync age, cache TTL, last update

**Sync token**:
The pasted credential the plugin stores server-side to authenticate the headless Obsidian Sync client. Never stored in host settings JSON and never sent to the client.
_Avoid_: API key, password, secret

**Paseo workspace**:
One working context inside Paseo, backed by a directory or worktree and owning its agents and terminals.
_Avoid_: Project, session, vault

**Paseo project**:
The sidebar grouping that contains one or more Paseo workspaces and represents a repository or directory known to Paseo.
_Avoid_: Workspace, repository
