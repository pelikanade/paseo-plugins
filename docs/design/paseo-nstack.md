# Design: paseo-nstack

Issue: none — direct build authorized. Grill: `docs/design/_intake/paseo-nstack-grill.md` @ 2026-10-09, amended 2026-10-10. Scaffold: none.
Glossary: `GLOSSARY.md` (+9 terms) ADRs: `docs/adr/0001-keep-orchestration-in-agents.md`
Method: mattpocock/skills @ `b0618bc` (prototype, codebase-design, domain-modeling, to-tickets)
Approval: the user approved direct implementation with “Go” and selected the original UI mix; no design PR was requested. The Issues-only contract below was explicitly approved after grilling on 2026-10-10 with “Implement this”. The intake records the current answers and preserves unrelated historical decisions.

## 1. Problem and done

- **Done predicate:** With an enabled binding between a Paseo workspace and a GitHub repository, a new supported signal starts exactly one fresh, write-enabled, auto-archived orchestrator agent in that workspace. Open issues with the sole workflow label `stack:ready` automatically signal readiness. The agent receives the signal, binding, and vendored nstack skill tree. The workspace panel shows watcher health and activity, and the started agent has one plugin timeline notice.
- **Non-goals / out of boundary:** Reimplement nstack routing, budgets, parallel limits, review rounds, overlap checks, CI-hold policy, merge policy, or worker behavior in TypeScript; write GitHub state from the watcher; merge pull requests; schedule `lessons-ledger`; use GitHub webhooks; store a PAT; require approval for each signal; duplicate GitHub issue lists; provide a workspace switcher; send operating-system notifications; publish generative-ui cards.
- **Constraints found while grounding:** Plugins run client and server code in separate runtimes. `PaseoApi` exists only in RPC and lifecycle callback contexts, so restored polling waits for the first such callback; opening the panel or a host lifecycle event supplies it. Agent creation requires an explicit provider selector; one plugin default is therefore required, with an optional workspace override. GitHub issues, label events, pull requests, checks, and comments use REST. The host `gh` login supplies the token, which is never persisted. Server cleanup must stop timers and owned I/O. Tests are real isolated-daemon E2E only; no unit tests or mocked Paseo host/provider.

## 2. Usage (caller's view, written first)

The server entry supplies deployment endpoints and delegates the entire lifecycle:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { installWatcher } from "./server/install";

export default function contribute(server: PluginServerContext) {
  return installWatcher(server, {
    github: {
      hostname: process.env.PASEO_NSTACK_GITHUB_HOST ?? "github.com",
      restBaseUrl:
        process.env.PASEO_NSTACK_GITHUB_REST_URL ?? "https://api.github.com",
    },
  });
}
```

The client registers one reusable workspace-panel type and one timeline renderer:

```tsx
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addWorkspacePanel({
      id: "nstack",
      title: "Automatic agents",
      icon: "Bot",
      context: "workspace",
      Component: NstackPanel,
    }),
    client.addTimelineRenderer({
      kind: "nstack-agent-started",
      version: 1,
      schema: startedNoticeSchema,
      Component: StartedNotice,
    }),
  ];
  return async () => {
    for (const cleanup of cleanups) await cleanup();
  };
}
```

Every panel call carries the exact workspace context:

```ts
await rpc(panelRpc, { workspaceId });
await rpc(saveSettingsRpc, { workspaceId, pluginDefaults, binding });
await rpc(checkNowRpc, { workspaceId });
```

The binding selects only repository owner/name. Watcher controls are automatic-start pause, check and repair intervals, connection test, and agent provider/model configuration. Workflow labels are fixed by [nstack-orchestrate § Issue workflow](../../plugins/paseo-nstack/skills/nstack/nstack-orchestrate/SKILL.md#issue-workflow); no workflow configuration or discovery endpoint is needed.

## 3. Strategy

- **Chosen shape:** `installWatcher(server, options): PluginCleanup` is the sole server interface. It synchronously registers RPCs and lifecycle hooks, gates work on one private initialization promise, captures the first callback's host-owned `PaseoApi`, and owns scheduling and shutdown. **Interface depth:** one installation call hides state validation, authentication, polling, signal normalization, persistence, agent creation, recovery, and timeline recording. **Seams:** shared Zod RPC contracts separate client transport from the watcher; configurable GitHub endpoints let production and E2E exercise the same HTTP implementation. Private signal collectors normalize issue-label events, other REST repository activity, and timed repair checks; they are a real internal seam because three source forms already exist.
- **Alternatives (design it twice):**
  - Generic `request/close` module under a separately constructed Paseo client — minimal surface, rejected because this SDK exposes no authenticated daemon client configuration at plugin setup.
  - Public `Nstack` class with `bind`, panel, CRUD, pause, and check methods — explicit and extensible, rejected because it duplicates the RPC-shaped surface and lets the entry coordinate lifecycle ordering.
  - Install-only deep module — chosen because handlers remain one-line private adapters and callers cannot bypass initialization, persistence, duplicate protection, or cleanup.
  - Native or hybrid TypeScript orchestration — rejected because it creates a second nstack policy engine that can drift from the shipped skills.
  - One persistent agent per binding — rejected because independent signals would share growing context and block one another.
- **Tradeoffs accepted:** Polling adds bounded latency and GitHub API traffic but avoids webhook provisioning. The watcher cannot start after a cold plugin reload until one RPC or lifecycle callback supplies `PaseoApi`; health makes that limitation explicit. A single versioned JSON document is simpler than a database but requires serialized atomic writes and bounded activity history. Started-agent creation cannot be transactionally committed with JSON, so a persisted launch intent, stable agent ID, and stable idempotency key are reconciled after ambiguous failures.
- **Decisions:** D1 read-only GitHub watcher; D2 full signal set; D3 one fresh agent per signal; D4 skills own worker/review policy and label writes; D5 one repository binding per workspace; D6 `gh` token plus direct REST; D7 enabling is standing permission with workspace and global pause; D8 exact-duplicate protection only; D9 one plugin provider/model default with workspace override; D10 hourly repair check with override/off; D11 plugin id `paseo-nstack` and all nstack skills vendored; D12 workspace panel plus started-agent timeline notice; D13 workflow counts, attention, health, and activity with settings in a modal; D14 14-code-file and 1,300-LOC original budget; D15 direct branch build and real E2E; D16 every panel and binding is keyed by `workspaceId`; D17 one deep installation interface; D18 canonical mutually exclusive issue workflow labels, conflicts requiring human attention, and closed issues excluded from active counts and Ready starts; D19 no old-settings migration because no real repositories used the plugin.
- **Panel shape:** One workspace dashboard with workflow counts, “Waiting on you”, recent activity, connection status, and watcher-owned settings in a modal. Current UI evidence must come from the Issues-only implementation.

- **Behavior contract:**
  - **P1 Initial synchronization:** Dispatch currently open issues with `stack:ready` as their sole workflow label once. Seed PR, CI, review, and comment cursors without replaying historical activity; the repair check covers stale or missed work.
  - **P2 Signal identity:** A handled-signal key includes binding ID, signal kind, GitHub subject identity, and occurrence version such as the latest `stack:ready` labeled event ID, head SHA, conclusion, comment ID, or repair window. Ready detection uses label events, not the issue's general `updated_at`: title/body edits, comments, and unrelated category-label changes must not produce another Ready start. Removing and later reapplying `stack:ready` is a new occurrence, subject to current-state checks and agent eligibility rules.
  - **P3 Ready authorization:** An enabled binding is standing permission to act on a currently open, unambiguously Ready issue, including labels applied by designer/orchestrator agents. Human comments and commands remain filtered to the login returned by GitHub `/user`. Agents still enforce human design approval, checkpoints, caps, review rules, and human-only merge.
  - **P4 Launch recovery:** Persist intent, stable agent ID, stable idempotency key, and event labels before creation. Reconcile the stable ID before every create and again after an error. Configuration failures remain blocked until the effective provider/model changes. Other failures use 30-second exponential backoff capped at 15 minutes and five attempts.
  - **P5 Defaults and retention:** Poll every 60 seconds. Run repair checks hourly. Both are configurable; repair can be off. Activity history is bounded to the newest 200 entries. Exact-duplicate launch history remains available up to 50,000 records per workspace; paused signals stop at 5,000 and cursors at 50,000. A full buffer rejects the observation transaction without advancing cursors, preserving existing work until the operator resumes or rebinds.
  - **P6 Global and workspace controls:** The settings modal edits the plugin provider/model default and global automatic-start state, plus the current repository owner/name, workspace pause, check and repair intervals, and optional model override. The header pause affects only the current workspace.
  - **P7 Workflow ownership:** The canonical states are `stack:backlog`, `stack:ready`, `stack:in-progress`, `stack:in-review`, `stack:merge-queue`, `stack:hitl`, and `stack:done`. Designer/orchestrator agents create missing labels and replace the prior workflow label while preserving unrelated category labels. The watcher only reads GitHub. Multiple workflow labels require human attention and block dispatch; they are never resolved by precedence. Unlabeled issues have no active workflow state. The issue list excludes closed issues and pull requests; closed issues never contribute to active counts or Ready starts even with stale labels. Agents apply Done in the merge/close loop; an unmerged PR with an open issue still escalates to HITL.

## 4. Code layout (the conformance contract)

| ID  | Path or glob                                                                                                     | New/Mod | Owns                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| L1  | `plugins/paseo-nstack/{paseo-plugin.json,package.json,tsconfig.json,README.md,index.server.ts,index.client.tsx}` | New     | Plugin metadata, package scripts, runtime entry wiring, operator documentation                                                |
| L2  | `plugins/paseo-nstack/shared/contracts.ts`                                                                       | New     | Zod RPC contracts, panel DTOs, binding drafts, signal/notice schemas                                                          |
| L3  | `plugins/paseo-nstack/server/install.ts`                                                                         | New     | S1 installation interface, RPC/hook registration, lazy Paseo binding, timer ownership, cleanup, private workflow coordination |
| L4  | `plugins/paseo-nstack/server/state.ts`                                                                           | New     | Versioned JSON, serialized mutations, atomic temp/write/rename, bounded history, launch intents and recovery records          |
| L5  | `plugins/paseo-nstack/server/github.ts`                                                                          | New     | `gh auth token`, read-only REST, pagination, user identity, issue and label-event reads, health                               |
| L6  | `plugins/paseo-nstack/server/signals.ts`                                                                         | New     | Ready, PR, CI, human feedback/command, and repair collectors; cursor evolution and stable handled-signal keys                 |
| L7  | `plugins/paseo-nstack/server/spawn.ts`                                                                           | New     | Provider/mode validation, skill-tree materialization, prompt assembly, stable agent creation, labels, timeline append         |
| L8  | `plugins/paseo-nstack/{skills/nstack/**,server/skills.generated.ts,verify/skills.mjs}`                           | New     | Vendored nstack source, generated exact skill map, generation/verification command and provenance                             |
| L9  | `plugins/paseo-nstack/client/panel.tsx`                                                                          | New     | One workspace dashboard, settings modal, query keys containing `workspaceId`, pause/check/test/save actions                   |
| L10 | `plugins/paseo-nstack/client/notice.tsx`                                                                         | New     | Started-agent timeline schema renderer                                                                                        |
| L11 | `e2e/paseo-nstack.e2e.mjs`, `e2e/support/nstack.mjs`                                                             | New     | Local GitHub HTTP fixture plus real isolated daemon, real plugin RPC/agent records, reload, and browser observations          |
| L12 | `GLOSSARY.md`, `docs/adr/0001-keep-orchestration-in-agents.md`, `docs/design/**`                                 | New     | Domain language, durable architecture decision, transcript, design, and signed UI assets                                      |

**Public surface:**

- **S1** `installWatcher(server, options): PluginCleanup`
- **S2** `panelRpc` — load one workspace's binding, counts, attention rows, health, activity, and global defaults
- **S3** `saveSettingsRpc` — atomically save global defaults and the current binding, or remove that binding
- **S4** `testConnectionRpc` — validate token, repository read access, provider/model, and write mode without launching
- **S5** `setPauseRpc` — pause/resume one workspace or automatic starts globally
- **S6** `checkNowRpc` — run the normal observation path immediately without bypassing pause or duplicate protection
- **S7** `startedNoticeSchema` — versioned timeline data for one accepted agent start

**Allowed dependencies:** Client and server entries may import `shared/`; client modules may import React, React Native, TanStack Query, and plugin client SDK only; server modules may import Node APIs and the plugin/client server SDK; `server/install.ts` may depend on L4–L8; L5 is the only GitHub HTTP/token module; L7 is the only agent-creation module; generated skill code depends only on vendored files.

**Forbidden:** Cross-runtime imports; DOM APIs outside a dedicated web module; direct GitHub calls from the client; agent starts outside L7; nstack policy in TypeScript; persisted credentials; mock-only production seams; source comments; an alias, compatibility path, or second watcher interface.

Layout rules file: `AGENTS.md` and `skills/paseo-plugin-dev/SKILL.md`.

Incidental allowlist: `pnpm-lock.yaml`, generated `server/skills.generated.ts`, vendored `skills/nstack/**`, `test-results/**` on failure.

## 5. Complexity and budget

- **Moving parts:** One deep watcher runtime; atomic state document; one concrete GitHub client; three internal signal-source forms; one agent starter; one generated skill map; one workspace panel; one timeline renderer; one real E2E scenario file and its GitHub fixture.
- **Risks / one-way doors:** The thin-watcher split is the one-way architecture decision recorded in ADR 0001. The crash gap between JSON and daemon creation can duplicate or lose work if stable identity reconciliation is wrong. Polling can hit rate limits or miss actor metadata. A provider may not expose write mode. Vendored skills can drift unless verification is exact. **Blast-radius fact:** enabling automatic starts grants the plugin permission to create write-enabled agents in that binding's workspace; pause blocks new starts but never cancels an already-created agent.
- **Budget:** implementation code files ≤14 plus manifests/docs and vendored skill data · new implementation code files ≤14 · new public surfaces = S1–S7 · new classes/services = 1 required for launch-error classification · net non-test TypeScript/JavaScript ≤3,600 · E2E plus fixture ≤1,100 LOC · slices/issues ≤4 · external runtime dependencies = 0.
- **Tolerance:** +25% files/LOC. **Historical gate result:** keep. The pre-amendment reliability-reviewed implementation used 11 source files, 3,589 non-test lines, and 1,073 E2E/fixture lines. The first grounded re-estimate was 3,200/650; recovery, retry, pagination, and corruption scenarios added 469 source lines and 456 executable-test lines. These counts are historical, not measurements of the Issues-only cutover.

## 6. Behavior scenarios

Evidence below specifies the required verification. The Issues-only amendment needs new implementation/E2E evidence; historical checks and screenshots do not prove the amended behavior.

- **B1** WHEN a valid enabled workspace binding is saved and an open issue has only `stack:ready` among the workflow labels, THE SYSTEM SHALL start one fresh write-enabled auto-archived orchestrator agent in that workspace with the normalized signal, binding, and vendored skill path, then record one started-agent timeline notice — required evidence: real isolated-daemon E2E observing the agent title, workspace, stable signal label, plugin state, and timeline.
- **B2** WHEN the same Ready label occurrence is observed by repeated polls, check-now, restart recovery, or after unrelated issue edits, THE SYSTEM SHALL not start another agent; a later removal and reapplication of `stack:ready` SHALL be a new occurrence subject to current-state checks — required evidence: E2E repeats label events across edits/restart and then supplies a distinct Ready label event.
- **B3** WHEN global automatic starts or the workspace binding is paused, THE SYSTEM SHALL continue observing and reporting GitHub state but SHALL not reserve or start a new agent; stale paused Ready signals SHALL be pruned as issues close, leave Ready, acquire conflicting workflow labels, or acquire a newer Ready occurrence. Resuming preserves duplicate protection and dispatches applicable buffered signals to agents that re-read current GitHub state — required evidence: E2E buffers Ready, PR, CI, and command signals under pause, changes a buffered Ready issue's eligibility or occurrence, then resumes and toggles the global pause gate.
- **B4** WHEN a new worker PR opens or changes head, a PR merges/closes, a CI result settles, or the authenticated human posts review feedback or a recognized command, THE SYSTEM SHALL normalize that occurrence and start exactly one orchestrator agent with its subject, SHA/result/comment, actor, and URL — evidence: the real-daemon E2E drives open, head, merge, close, CI, feedback, and command transitions through the production REST client and asserts their persisted agent signal keys.
- **B5** WHEN the repair interval becomes due, THE SYSTEM SHALL start one repair-check agent for that binding and time window; when repair is off, no repair signal is produced — evidence: E2E reloads persisted state with a due repair window and observes one repair-labeled agent; the nullable interval gates repair collection and wake scheduling.
- **B6** WHEN `gh` authentication, GitHub HTTP, persisted state, provider/model validation, or agent creation fails, THE SYSTEM SHALL expose a redacted actionable health/activity error, keep the plugin process alive where safe, and recover on the next successful check without guessing a provider or creating duplicate agents — evidence: E2E covers GitHub 503/redaction/recovery, transient and corrupt state loads, stable-agent reconciliation, blocked configuration recovery, bounded retries, and launch backoff.
- **B7** WHEN the plugin or daemon reloads, THE SYSTEM SHALL restore bindings, cursors, handled signals, activity, and launch intents, then resume schedules after an RPC or lifecycle callback supplies `PaseoApi` without historical PR/CI/comment replay — evidence: isolated plugin-reload and daemon-restart E2E.
- **B8** WHEN the panel is opened in two workspaces, THE SYSTEM SHALL show independent repository bindings and activity keyed by each `workspaceId`; the settings modal SHALL contain repository owner/name, pause/check/repair controls, agent configuration, and connection test — required evidence: two-workspace real-daemon assertions and current Web UI browser observation.
- **B9** WHEN an issue has conflicting workflow labels, THE SYSTEM SHALL show human attention and prevent dispatch rather than choose a state — required evidence: E2E with `stack:ready` plus another workflow label, including pause/resume.
- **B10** WHEN an issue is closed, THE SYSTEM SHALL exclude it from active counts and Ready starts despite stale labels; the agent close loop SHALL set Done while preserving unrelated labels — required evidence: E2E for closed-issue observations and a real agent workflow exercising merge/closure label transitions, including the distinct unmerged-PR/open-issue HITL case.

## 7. Slices (to-tickets; count ≤ budget `issues`; merge = permission to file)

1. **Ready work starts exactly once**
   Blocked by: none
   Delivers: A user can open one workspace panel, save its repository owner/name binding, test the connection, run a check, and observe one open Ready issue start one orchestrator agent with vendored skills and a timeline notice.
   Design refs: L1–L11, S1–S4, S6–S7, B1–B2, B9–B10
   Seams: S2–S4/S6 RPCs through a real isolated daemon — catches runtime boundaries, persistence, GitHub fixture integration, workflow conflicts, closure, and workspace scoping / misses later signal kinds and restart recovery; generated-skill verifier — catches vendored/generated drift / misses skill semantics.
   Verify: Serving one open Ready issue fails to produce exactly one correctly configured workspace agent and one notice, repeating or editing unrelated issue content changes agent count, or closed/conflicted issues start work.
   Type: AFK · Checkpoint: yes

2. **Repository activity reaches the orchestrator**
   Blocked by: slice 1
   Delivers: Pull-request open/head/merge/close, CI, and authenticated-human feedback/commands use the same exactly-once path, and their outcomes appear in workflow counts, attention rows, and recent activity. Agents close the loop with Done or HITL labels as appropriate.
   Design refs: L2–L7, L9–L11, S2, S6–S7, B4, B10
   Seams: GitHub fixture through production L5 plus daemon agent list — catches endpoint parsing, cursors, normalized identity, and dispatch / misses live GitHub rate-limit behavior.
   Verify: Any supported occurrence is absent, lacks required SHA/result/actor/URL context, or repeated fixture state creates another agent.
   Type: AFK · Checkpoint: no

3. **Automation survives pauses, failures, and reloads**
   Blocked by: slice 2
   Delivers: Global and workspace pause, repair scheduling/off, provider validation, redacted health, stable launch recovery, and daemon reload preserve exactly-once behavior.
   Design refs: L2–L7, L9, L11, S2–S6, B3, B5–B7
   Seams: Settings/check RPCs plus real daemon restart — catches persisted transitions, timer cleanup/restart, waiting-host state, and agent reconciliation / misses operating-system crash during the filesystem rename itself.
   Verify: A paused binding starts work, repair-off emits a signal, secrets appear in state/logs, reload replays historical activity, or an ambiguous launch creates a second agent identity.
   Type: AFK · Checkpoint: no

4. **The workspace dashboard is the complete operator surface**
   Blocked by: slice 3
   Delivers: The workflow-count dashboard, repository-only settings modal, per-workspace query scoping, global defaults, pause/check/test/save actions, responsive React Native layout, plain-language activity, and started-agent timeline rendering.
   Design refs: L1–L2, L8–L12, S2–S7, B8–B10
   Seams: Real daemon-served Web UI driven by Playwright — catches registration, workspace context, RPC wiring, visible states, and interaction / misses native rendering; `pnpm format`, `pnpm check`, and full `pnpm test:e2e` catch repository integration.
   Verify: Two workspace tabs share data, the panel duplicates GitHub issue lists or nstack policy controls, the modal omits required watcher settings, or the actual UI violates the current binding and workflow contract.
   Type: AFK · Checkpoint: yes

Unmapped L/S/B: none.

## 8. Open questions

None.

## Amendments

- 2026-10-09: Reliability review added recoverable initialization, corrupt-state quarantine, stable-agent reconciliation, terminal and bounded launch failures, shutdown-safe scheduling, complete pagination, comment-edit deduplication, and explicit state caps. Review polling is skipped for pulls whose `updated_at` did not change.
- 2026-10-10: User-approved Issues-only cutover after grilling; final confirmation: “Implement this”. Repository owner/name is the complete binding identity; canonical issue labels define workflow, the latest Ready labeled event ID identifies a readiness occurrence, conflicts block dispatch, and closed issues and pull requests are excluded from the issue list. Stale paused Ready signals are pruned. Agents own label creation and transitions; GitHub access from the watcher remains read-only. Existing permissions, human design/merge gates, caps, review policy, pause, and deduplication remain. No old-settings migration: “Ignore them, no real repos used this plugin yet”. Superseded tracking/API intake entries and obsolete screenshot references are removed. This reversible choice needs no ADR.
