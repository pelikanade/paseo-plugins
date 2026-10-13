# Grill transcript: paseo-obsidian

Design-session record from 2026-10-13. The current contract is in [the design](../paseo-obsidian.md) once written.

Repo: `pelikanade/paseo-plugins`, branch `plan/paseo-obsidian-plugin`
Date: 2026-10-13
Griller: omp/magpie/deepseek/deepseek-flash, one round of numbered frontier questions per turn
Method: grill-with-docs (mattpocock/skills), with `domain-modeling` for `GLOSSARY.md` and ADRs
Status: ready-for-design — rounds 1–6 settled; slice order and budget awaiting confirmation

## Context

- The user wants an Obsidian vault available to Paseo agents on the daemon host: headless Obsidian Sync login, pull and update, read-only by default with a read-write switch, chat references into the vault, a global skill / system prompt appended from files inside the vault, and MCP tools for retrieval and (later) writes.
- Installed SDK is now `@getpaseo/plugin` **0.11.2**, matching the daemon on the development machine. The workspace pinned 0.10.2 while rounds 1–4 ran and was upgraded on 2026-10-13 at the user's instruction, together with `@getpaseo/cli` and `@getpaseo/client`. Verified 0.11.2 client surface: `addScreen`, `addSidebarHeaderItem`, `addSidebarFooterItem`, `openScreen`, `openPopover`, plus the deprecated `addSurface`, `addSidebarItem`, and `openSurface`; `addWorkspacePanel`, `addCommandCenterItem`, `addSlashCommand`, `addHeaderButton`, `addComposerPill`, `addAttachmentSource`, `addSettingsScreen`, `addTimelineRenderer`, `addTimelineTransformer`, `addTheme`, `openPanel`, `openSettings`. Server surface: `handle` (Zod RPC), `registerSettings`, `registerProvider`, `spawnProcess`/`execCommand`/`terminateProcess`, `on(...)` lifecycle events (now including `agent.closed`), `before(...)` request hooks.
- Chat has no `$`-mention feature and no mention extension point at 0.11.2; the host's own composer autocomplete is `@` for workspace files and is not extensible. The only picker a plugin can contribute is an attachment source, and the host calls its `search` RPC with `{ query }` only.
- Plugin MCP tools are contributed by mutating `request.config.mcpServers` inside `server.before("agent.create", ...)`; tool preapproval is `config.toolPolicy.preapproved`. Paseo 0.11.2 has no plugin skill registry and the SDK exports nothing skill-related; Paseo's own skills come from directories each provider scans (`$CODEX_HOME/skills` and `<cwd>/.codex/skills` for Codex, `~/.agents/skills` and `<cwd>/.agents/skills` for the omp and Claude families), where only `SKILL.md` front matter reaches the prompt.
- There is no secrets API. Settings are host-scoped JSON documents, explicitly "not a credential vault".
- Existing plugins persist data under `$PASEO_HOME/plugin-data/<id>/` using Node APIs.
- Tests are real isolated-daemon E2E only; no unit tests, no mocked host, provider, or transport.

## Design tree

- Make vault content available to agents.
  - Where the vault comes from: headless Obsidian Sync client, plugin-managed directory — settled (round 1 Q2).
  - How much access: read-only in v0; read-write deferred to a later slice — settled (rounds 1–3).
  - Which layer "read-only" binds: tool layer plus sync direction — settled (round 1 Q1).
  - Scope: one vault per daemon, global — settled (round 1 Q3).
  - Agent-facing surface: MCP tools only, no path environment variable — settled (round 2 Q6).
  - Chat reference: host attachment picker only, inserting a path plus an 8 KB snapshot — settled (rounds 1 Q6, 3 Q7/Q8b).
  - Prompt injection: multiple files from inside the vault, injected for all agents — settled (rounds 1–2 Q5/Q8, round 3 Q3/Q4).
  - Credentials: pasted `auth_token` in a plugin-owned 0600 file, passed to `ob` as `OBSIDIAN_AUTH_TOKEN` — settled (rounds 1 Q8, 3 Q9, 4 Q4/Q5).
  - Sync cadence: `ob sync --continuous` under plugin supervision, reconnection delegated to the client — settled (rounds 1 Q7, 3 Q10, 4 Q2/Q3).
  - Verification: default suite with no credentials against a seeded vault, plus a credential-gated real-sync suite — settled (round 4 Q1).
  - UI: delegated to a Haiku 5.5 subagent on this branch — settled.

## Rounds

### Round 1 — scope and ownership

**Q1 只读语义:** which layer does "read-only by default" bind?
**A1:** Tool layer plus sync layer. No write tools by default, no local-to-remote push, and the vault lives outside the workspace cwd so an agent's ordinary file tools never reach it.

**Q2 vault 归属:** who provides the local vault directory?
**A2:** Plugin-managed directory by default (`$PASEO_HOME/plugin-data/obsidian/vault`), overridable in settings to an existing local vault path.

**Q3 作用域:** vault-to-workspace mapping?
**A3:** One global vault per daemon, visible to every agent. Per-workspace binding is deferred.

**Q4 MCP 工具面:** tool granularity and write boundary?
**A4:** Filesystem-like tools, not semantic note tools: list, glob, grep, read, write, restricted by a path whitelist inside the vault. (Superseded in round 2 Q2–Q3 by read-only v0.)

**Q5 prompt 注入:** source files and injection scope?
**A5:** Multiple files by convention: `.paseo/system.md` appended to the system prompt, and every `.paseo/skills/*.md` injected as its own section.

**Q6 chat 引用:** trigger for referencing vault content?
**A6:** Use the host's attachment picker, whose trigger character may be `@` rather than `$`, with `/obsidian` slash commands as the fallback; document the actual trigger.

**Q7 同步时机:** when do vault updates appear?
**A7:** Continuous watch.

**Q8 凭据:** where do Obsidian credentials live?
**A8:** Entered in the plugin settings screen, stored server-side under `$PASEO_HOME` with mode 0600, environment override allowed, never visible to the client.

**Q9 E2EE:** does the vault use an Obsidian Sync encryption password?
**A9:** "否" — this vault is not end-to-end encrypted. The password stays an optional settings field.

**Q10 交付物:** artifacts and naming?
**A10:** Documents only on this branch: `docs/design/_intake/paseo-obsidian-grill.md`, `docs/design/paseo-obsidian.md`, `docs/design/paseo-obsidian-ui.md`, root `GLOSSARY.md`, `docs/adr/NNNN-*.md`. Plugin directory `plugins/obsidian`, package `@pelikanade/paseo-plugin-obsidian`, manifest id `obsidian`.

### Round 2 — writes, injection detail, failure behaviour

**Q1 写入并发:** what happens when the desktop app edited a note between an agent's read and write?
**A1:** Content-hash optimistic locking: reads return a hash, writes must present it, and a mismatch is rejected with a re-read instruction.

**Q2 推送时机:** when do agent edits reach the remote?
**A2:** "v0 先做只读模式" — v0 is read-only, so push is out of scope for v0.

**Q3 写范围:** write scope inside the vault?
**A3:** "同上" — deferred with the write path.

**Q4 检索能力:** do we go beyond list/glob/grep?
**A4:** Filesystem-like tools only. No tags, frontmatter filters, or relevance-ranked index.

**Q5 模式切换:** what happens to running agents when read-only flips to read-write?
**A5:** "同上" — deferred with the write path.

**Q6 vault 发现:** how does an agent learn the vault's location?
**A6:** MCP tools only. The system prompt states the vault name, current mode, and last sync time; no path environment variable, because a path would let an agent bypass the tool layer and write files directly.

**Q7 slash 命令:** which `/obsidian` subcommands?
**A7:** "不做 slash" — no slash commands at all.

**Q8 注入细节:** injection limits and ordering?
**A8:** `.paseo/system.md` appended to the system prompt; `.paseo/skills/*.md` sorted by file name, each with a source header. 32 KB per file, truncated past the limit with a warning in the settings panel.

**Q9 陈旧数据:** how do tools behave when sync is stale or failing?
**A9:** Return content with `lastSyncedAt` and a stale marker. Never block. Panel and tool results both flag a failure past a threshold.

**Q10 E2EE 字段:** keep the optional encryption password field?
**A10:** Keep it as an optional field.

### Round 3 — v0 boundary, surfaces, verification

**Q1 v0 边界:** confirm the read-only v0 cut?
**A1:** Read-only v0: managed pull, read-only tools, prompt injection, panel and status. Write tools, push, and the mode switch are slice B, documented but not built.

**Q2 工具语义:** input semantics for the read-only tools?
**A2:** Plain vault-relative paths. No `[[wikilink]]` or title resolution.

**Q3 注入范围:** which agents receive the injected prompt?
**A3:** All agents created on the daemon. No project whitelist or exclusion list.

**Q4 注入落地:** what if the injection files do not exist?
**A4:** Do not create them. Skip silently and show "not injected" plus the expected paths in the panel.

**Q5 数据源:** is an existing local vault directory a first-class source?
**A5:** "只做 sync" — sync only, no separate local source mode.

**Q6 测试策略:** how is behaviour verified?
**A6:** A default suite using a seeded local vault plus a separate credential-gated Sync suite, with prerequisites documented and a clear error when credentials are missing. (Conflicts with A5; see open items.)

**Q7 引用内容:** what text does picking a note insert?
**A7:** Vault-relative path plus a content snapshot, capped at 8 KB per note, truncated with a marker, and a hint that tools can read the current version.

**Q8 面板位置:** where does the vault UI live?
**A8:** A global surface with a sidebar item, plus a settings screen. Not a per-workspace panel, because the vault is global.

**Q8b 命令中心:** add ⌘K items?
**A8b:** "不加" — none.

**Q9 登录交互:** how does login work?
**A9:** The user pastes a token obtained elsewhere; the plugin does not run an interactive login flow. Feasibility depends on what the headless client accepts.

**Q10 断线与并发:** continuous watch reliability?
**A10:** Keep a long-lived watch, reconnect with backoff, show connection state in the panel, and use a lock file so two sync processes never run at once.

### Round 4 — verification, sync details, read boundaries

Facts confirmed before this round, from the official client: `obsidian-headless@0.0.14` (bin `ob`, `license: UNLICENSED`, Node ≥ 22, `better-sqlite3` + `commander`); `OBSIDIAN_AUTH_TOKEN` overrides `<config>/auth_token`; the Linux config directory is `$XDG_CONFIG_HOME/obsidian-headless` or `~/.config/obsidian-headless`, with `auth_token` written 0600 and the directory 0700; `sync-config --mode pull-only|bidirectional|mirror-remote`, `--configs`, `--excluded-folders`, `--config-dir` (default `.obsidian`); `sync --continuous` reconnects and retries on its own and keeps a lock at `<config-dir>/.sync.lock`; `sync-list-remote`, `sync-status`, and `sync-config` accept `--json`.

**Q1 测试隔离:** how does the default suite avoid a paid account?
**A1:** Default suite runs with no credentials configured and a pre-seeded managed directory, so the plugin spawns no sync process while RPC, tools, injection, and the UI are all exercised. A separate suite covers real sync with real credentials.

**Q2 只读模式:** which client mode?
**A2:** `pull-only`. `mirror-remote` would revert local changes and delete files written directly into the directory.

**Q3 配置同步:** sync `.obsidian/`?
**A3:** No. `--configs ""` by default.

**Q4 ob 发现:** how is the binary located and validated?
**A4:** Look on `PATH`, allow an absolute path in settings, and report a clear prerequisite error when it is missing or the runtime is older than Node 22. No bundling and no self-install, because the package is `UNLICENSED`.

**Q5 令牌获取:** where does the token come from?
**A5:** The user runs `ob login` elsewhere and pastes the value from `~/.config/obsidian-headless/auth_token`. The plugin stores it in its own 0600 file and passes it to child processes through `OBSIDIAN_AUTH_TOKEN`.

**Q6 vault 选择:** how is the remote vault chosen?
**A6:** The panel lists `ob sync-list-remote --json` results and the user picks one.

**Q7 读边界:** what can the read tools reach?
**A7:** Not `.obsidian/` and not `Trash/`. Attachments return path, size, and modification time, never binary content, unless explicitly requested and capped.

**Q8 陈旧阈值:** when does data count as stale?
**A8:** 15 minutes without a successful sync.

**Q9 错误体验:** how do tools answer when setup or sync is broken?
**A9:** Structured errors — `ob` missing, token invalid, remote unreachable, vault missing — each with a repair action in the panel. Never a silent empty result.

### Round 5 — SDK version and skill delivery

Two facts were established before this round. Paseo's native skill mechanism is filesystem scanning by each provider: `listCodexSkills` reads `<cwd>/.codex/skills`, the parent directory, the repository root, and `$CODEX_HOME/skills`, parses `SKILL.md` front matter, and registers `name`/`description` with `kind: "skill"` (`@getpaseo/server` 0.11.2 `dist/server/server/agent/providers/codex-app-server-agent.js`); the omp provider maps a skill source through its own CLI (`providers/omp/commands.js`); this machine's `~/.agents/skills` and the project's `.agents/skills` symlinks are what fill the current agent's skill list. There is no plugin API that registers a skill at 0.10.2 or 0.11.2, and an MCP resource claiming a `skill://` URI does not resolve in this runtime (`skill://generative-ui/SKILL.md` was refused while `skill://paseo-plugin-dev/SKILL.md` worked).

**Q1 skill 交付:** how should vault skills reach agents — a prompt index plus tool reads, mirroring the files into a provider-scanned skill directory, or inlining full text?
**A1:** Not answered. The user replied "你看一下当前paseo版本呢，现在好像不是0.10.2了" — verify the running Paseo version first, because the earlier grounding may be stale. Verification confirmed the daemon is **0.11.2** while the workspace pinned 0.10.2, and the 0.11.2 SDK still exposes no skill API, so the question is re-asked with that context.

**Q2 缺 frontmatter:** what happens to a vault skill file with no `name`/`description`?
**A2:** "直接跳过" — skip it. No name/description fallback and no full-text injection.

Follow-up instruction in the same turn: "SDK版本也升级吧". The workspace upgrade was executed on this branch — `@getpaseo/cli`, `@getpaseo/client`, `@getpaseo/plugin`, and `@getpaseo/protocol` moved from 0.10.2 to 0.11.2, the E2E `appVersion` moved with them, `plugins/hello-paseo` migrated from `addSurface`/`addSidebarItem` to `addScreen`/`addSidebarHeaderItem` (the deprecated aliases fail `pnpm lint`), and the version-bearing documentation was swept. An independent worktree (`chore/pnpm-catalog`, separate agent) hoists the SDK versions into a pnpm catalog and re-verifies every plugin.

### Round 6 — skill delivery route

Re-asked with the 0.11.2 facts: the SDK still exposes no skill API, native skills come from provider-scanned directories, and an MCP resource with a `skill://` URI does not resolve in this runtime.

**Q1 skill 交付:** prompt index plus tool reads, mirroring the files into a provider-scanned skill directory, inlining full text, or a split where v0 indexes and mirroring comes later?
**A1:** Prompt index plus tool reads. `.paseo/system.md` is appended in full under a 32 KB cap; each `.paseo/skills/*.md` contributes only its front-matter `name`, `description`, and vault-relative path, and the body is read on demand with `read_vault`. A skill file without front matter is skipped, per round 5. Mirroring into `~/.agents/skills` or a Codex skills directory is a deliberate non-goal for v0 because it writes outside plugin data, needs ownership bookkeeping, and only takes effect for new sessions.

## Settled decisions

- **D1** One vault per daemon, global to every agent; the plugin manages its directory under `$PASEO_HOME/plugin-data/obsidian/`, overridable to an existing path.
- **D2** v0 is read-only: no write tools, no push, no mode switch. Read-write is slice B in the same design.
- **D3** "Read-only" binds the tool layer and the sync direction. It is not enforced at the filesystem level.
- **D4** Agents reach the vault only through MCP tools injected at `agent.create`; no vault path is injected into the environment.
- **D5** Injection is `.paseo/system.md` appended to the system prompt plus `.paseo/skills/*.md` in name order, for every agent on the daemon, 32 KB per file.
- **D6** Chat references use the host attachment picker; the inserted text is the vault-relative path plus a snapshot truncated at 8 KB.
- **D7** Credentials are a pasted token stored in a 0600 server-side file, never in host settings JSON, never sent to the client.
- **D8** Tools return `lastSyncedAt` and a stale marker instead of blocking.
- **D9** Sync runs as a long-lived watch with backoff, a single-instance lock, and status in the panel.
- **D10** The UI is a global surface plus sidebar item and a settings screen; no slash commands, no command-centre items, no per-workspace panel.
- **D11** Documents only on this branch: intake transcript, design, UI design, glossary, ADRs.
- **D12** Read-only v0 is implemented as `ob sync-config --mode pull-only` plus a tool set with no write operations; `.obsidian/` configuration is not synced (`--configs ""`).
- **D13** `ob` is an external prerequisite found on `PATH` or at an absolute path in settings; a missing binary or a runtime older than Node 22 reports `ob_missing`. The plugin never bundles or installs it.
- **D14** The default E2E suite runs with no credentials and a pre-seeded managed directory; real sync is covered by a separate credential-gated suite with documented prerequisites.
- **D15** Data older than 15 minutes without a successful sync is marked stale; tools never block, and unconfigured or broken setup returns structured errors with a repair action in the panel.
- **D16** Read tools exclude `.obsidian/` and `Trash/`; attachments return path, size, and modification time instead of binary content.
- **D17** The remote vault is chosen from `ob sync-list-remote --json` results listed in the panel.
- **D18** A vault skill file without `name`/`description` front matter is skipped, with the reason reported; nothing is injected as a fallback.
- **D19** The workspace targets Paseo **0.11.2**: CLI, client, plugin SDK, and protocol are pinned to 0.11.2, the new plugin requires `>=0.11.0`, and `hello-paseo` moved to `>=0.11.0` when it adopted `addScreen`/`addSidebarHeaderItem`. `devenv`, `generative-ui`, and `filler-noise` keep `>=0.10.2` because their code uses no 0.11-only API.
- **D20** Vault skills ship as a prompt index: `.paseo/system.md` in full under a 32 KB cap, and one front-matter index line per `.paseo/skills/*.md` with the body read on demand through `read_vault`. Mirroring them into a provider-scanned skill directory is a non-goal for v0 — it would write outside plugin data, need ownership bookkeeping, and only take effect for new agent sessions.

## Open items

- **O1–O4 resolved** in round 4: the default suite needs no account (D14), the pasted token is a supported client input (D7/D13), continuous mode exists and reconnects on its own (D9), and plugin state lives under `$PASEO_HOME/plugin-data/obsidian/`.
- Remaining detail for slice S2: which line of the watcher's progress output marks a completed pull (the source of `lastSuccessAt`, since `sync-status --json` carries no timestamp), and whether a rejected token is distinguishable from an unreachable remote in stderr. `sync-status --json` field names and the exit codes are known: 3 no sync configuration, 2 missing E2EE key, 1 otherwise.

## Deferred / open

Slice B (read-write): write tools with content-hash optimistic locking, `bidirectional` sync mode, push timing, write scope inside the vault, and how a mode flip reaches running agents.

## Glossary

Terms recorded in [`GLOSSARY.md`](../../../GLOSSARY.md).
