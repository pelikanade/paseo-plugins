# Grill transcript: paseo-nstack

Design-session record from 2026-10-09, amended by the approved Issues-only grill on 2026-10-10. Superseded tracking and API entries have been removed; unrelated historical answers retain their original wording and numbering. The current contract is in [the design](../paseo-nstack.md).

Repo: local Paseo plugins checkout, branch `build-paseo-github-orchestrator-plugin` (no `origin` remote)  
Date: 2026-10-09T19:38:41+08:00  
Griller: omp/opencode-go/glm-5.3  
Method: grill-with-docs (mattpocock/skills @ `b0618bc`), asked one question at a time  
Status: ready-for-design
Shared understanding confirmed: "Go"; the final UI direction is the user-approved mix of the clean-room layout and watcher-only settings.

## Context

- The nstack orchestrator skill defines what to do after a signal arrives, but not how the signal reaches it.
- Paseo already owns workspaces, agents, model selection, timelines, and agent lifecycle.
- A Paseo plugin server can create agents, target a workspace, set a model and mode, use an idempotency key, observe completion, and add timeline items.
- The plugin SDK has no storage, timer, secret, or GitHub API. Existing plugins use Node timers and JSON under `$PASEO_HOME/plugin-data/<id>/`.
- Paseo runs each plugin server in its own child process and calls its cleanup on reload or disable.
- The daemon has an internal GitHub service, but plugins cannot call it. The host `gh` login is available.
- Real plugin tests use the repository's isolated-daemon E2E harness. Unit tests are not used here.
- The existing nstack skills live outside the repository. This plugin will ship copies so started agents do not depend on those paths.
- Prototype branch: `proto/paseo-nstack` @ `d32f303`.

## Design tree

- Make nstack react without a human watching GitHub.
  - Where decisions live: started agents run the skill; the plugin only watches and starts them — settled.
  - Which events count: all nstack events plus a timed repair check — settled.
  - How work is started: one fresh agent per event in the linked workspace — settled.
  - How GitHub and workspaces are linked: saved per-workspace bindings — settled.
  - Authentication: reuse the host `gh` login, then call GitHub over HTTP — settled.
  - Permission: enabling a binding is standing permission; pause remains available — settled.
  - Duplicate protection: one stable key per event; no additional plugin-side limit — settled.
  - Visibility: workspace panel plus one notice in each started agent's timeline — settled.
  - Skill delivery: ship the nstack skills inside `paseo-nstack` — settled.
  - Panel structure: card layout with plain text — settled; final visual treatment reopened for a Haiku redesign.
  - Build process: transcript and design in this branch, then implementation and real E2E — settled.

## Rounds

### Round 1 — scope and ownership

**Q1 Orchestration brain:** signal pump; native TypeScript seat; hybrid.  
**A1:** Signal pump. The plugin watches and starts an agent; the agent runs `nstack-orchestrate`.

**Q2 Events watched:** full nstack set; smaller dispatch-critical set; Ready only.  
**A2:** Full set.

**Q3 Started-agent input:** event and binding only; plugin-defined worker policy; full prompt template.  
**A3:** Event and binding only. The skill owns worker choices.

**Q4 Saved binding:** plugin state and panel; host settings; repository file.  
**A4:** Plugin state edited from the workspace panel.

**Q6 Permission:** enabling the binding is permission; approve each event; approve the first event.  
**A6:** Enabling the binding is standing permission. Add per-binding and global pause controls.

**Q7 Plugin-side limits:** small safety limit; full nstack limits; no plugin-side limit.  
**A7:** No plugin-side limit. Use stable event keys; agents apply nstack's own rules.

**Q8 Client surface:** workspace panel and timeline notices; panel only; add generative-ui cards.  
**A8:** Workspace panel and one notice per started agent.

**Q9 Delivery:** direct build with transcript and design; full nstack issue filing; no design doc.  
**A9:** Direct build in this worktree with the transcript, design, code, and real E2E. Open a PR only when requested.

### Round 2 — agent and skill details

**Q1 Agent lifetime:** fresh agent per event; one long-lived agent per binding.  
**A1:** Fresh agent per event, auto-archived after it finishes.

**Q2 Skill location:** saved path; hard-coded path.  
**A2:** Custom answer: "Vendor the nstack skills. the plugin shall be named `paseo-nstack`."

**Q3 Model:** set per binding with daemon default as fallback; always daemon default; plugin guesses a tier.  
**A3:** Set per binding; use the daemon default when empty.

**Q4 Repair-check interval:** hourly with override and off; every 15 minutes; off by default.  
**A4:** Hourly, changeable per binding, with off available.

### Round 3 — goal, panel, and budget

**Q1 Goal restatement:** confirm that the missing piece is automatic notice-and-start behavior, not another copy of the orchestrator rules.  
**A1:** The user continued to the panel design.

**Q3 Prototype:** the user requested `/prototype`. Three layouts were produced: dense table, cards, and narrow rail.  
**A3:** "Stop using jargon and speak coherently. State it more simply and concisely. Use Layout B and rewrite the texts."

**Q4 Complexity budget:** keep about 14 code files; fold server modules; remove most of the panel.  
**A4:** Keep it. The repository's existing plugins use the same level of separation.

**Q5 Shared understanding:** proceed or reopen a branch.  
**A5:** "Go".

### Round 4 — UI redesign

The user asked for an independent redesign from `omp/openrouter/anthropic/claude-haiku-5.5`, then required a clean-room start. The first redesign agent was archived before review. Fresh agent `960742ae-9b04-47cc-9731-02b8c6c27bfb` worked on branch `proto/paseo-nstack-clean-ui` from committed base `d13915c`. Its only initial inputs were `AGENTS.md`, the Paseo plugin-development guide, `STACK.md`, `nstack-orchestrate/SKILL.md`, and linked official Paseo documentation. It was forbidden from reading the prototype, screenshots, design transcript, source code, git history, or prior agent output. The user excluded duplicate GitHub issue lists, confirmed one panel tab per workspace, selected a mix of the clean-room information layout and watcher-owned settings, and asked that settings move into a modal. The final revision is commit `accd29a`.

### Round 5 — approved Issues-only workflow (2026-10-10)

Recorded answers:

- Workflow labels: "Standard stack labels".
- Ready behavior: "Start when marked Ready".
- Existing settings: "Ignore them, no real repos used this plugin yet".
- Label creation: "Agents create labels".
- State exclusivity: "One state per issue".
- Final confirmation: "Implement this".

Approved outcome: bind each workspace to a GitHub repository owner/name. Canonical workflow labels are `stack:backlog`, `stack:ready`, `stack:in-progress`, `stack:in-review`, `stack:merge-queue`, `stack:hitl`, and `stack:done`. Designer/orchestrator agents create missing labels and replace the prior workflow label while preserving category labels; the watcher reads GitHub through REST. Open issues marked Ready automatically signal, using the latest `stack:ready` labeled event ID. Unrelated edits do not start work again. Conflicting workflow labels require human attention and prevent dispatch. Closed issues and pull requests are excluded from the issue list; agents apply Done in the merge/close loop. Stale paused Ready signals are pruned. Pause, duplicate protection, permissions, human design/merge gates, caps, and review rules remain. Existing settings need no migration. This reversible choice needs no ADR.

## Settled decisions

- **D1** `paseo-nstack` is a watcher, not a second implementation of nstack orchestration — user-approved over native and hybrid implementations.
- **D3** Each event starts one fresh Paseo agent in the linked workspace. The agent receives the event, the binding, and the vendored orchestration skill — accepted recommendation.
- **D4** The started agent owns worker routing and review choices. The plugin does not copy those rules — accepted recommendation.
- **D7** Enabling a binding is standing permission. Started agents use write mode. The panel provides binding pause and global pause — accepted recommendation.
- **D8** The plugin prevents only exact duplicate event starts with a stable idempotency key. It does not impose another parallel-work limit — user chose this over the recommendation.
- **D9** The panel sets one plugin-wide provider/model default; each binding may override it. The plugin never guesses from provider ordering — revised after confirming that the SDK exposes no daemon-wide default provider.
- **D10** The hourly repair check can be changed or turned off — accepted recommendation.
- **D11** The package and plugin id are `paseo-nstack`. It ships the nstack skills it needs — user-authored decision.
- **D12** The client uses a workspace panel and one timeline notice in each started agent. It does not use generative-ui cards or operating-system notifications — accepted recommendation.
- **D13** The panel shows workflow counts, "Waiting on you", recent activity, and connection status for one workspace, without duplicate GitHub issue lists or a workspace switcher. A settings modal contains only the binding, automatic-start pause, check and repair intervals, provider/model override, and connection test. Nstack policy controls do not appear — user-authored final UI verdict.
- **D14** Keep the normal plugin file split. Budget: no more than 14 code files plus vendored skill data, net new non-test TypeScript/JavaScript no more than 1,300 lines, no more than four implementation slices, with 25% file/LOC tolerance — accepted recommendation.
- **D15** Build directly on this branch after the design is final; run the repository's real isolated-daemon E2E; hand the branch back for review — accepted recommendation.
- **D16** The dashboard is one workspace panel tab per Paseo workspace. Its data and saved binding are keyed by `workspaceId`; different workspaces under the same Paseo project do not share a binding implicitly — confirmed from the workspace-panel context contract.
- **D17** The server exposes one deep installation function that owns RPC registration, lazy Paseo binding, timers, state transitions, recovery, and cleanup. Concrete state, GitHub, signal-collection, and agent-start modules stay private. This was chosen over a generic request dispatcher that required unavailable client credentials and a wider class of RPC-shaped public methods — design-it-twice comparison with three `omp/openai-codex/gpt-6.1-sol` agents.

## Deferred / open

None.

## Glossary

- **Binding:** a saved link from one Paseo workspace to one GitHub repository, identified by owner/name.
- **Workflow state:** an issue's stage of work, represented by exactly one canonical workflow label.
- **Signal:** one GitHub change or timed repair check that may start an orchestrator agent.
- **Watcher:** the plugin process that checks GitHub, remembers handled signals, and starts agents.
- **Orchestrator agent:** a fresh Paseo agent handling one signal with the vendored `nstack-orchestrate` skill.
- **Pause:** stop starting new agents without deleting a binding or its history.
- **Repair check:** a timed signal that asks the orchestrator to find missed or stale work. UI avoids the term "sweep".
- **Vendored skill:** a copy of an nstack skill shipped inside the plugin and made readable to started agents.

Avoid in user-facing text: `spawn`, `dedupe`, `sweep`, `seat`, `pump`. Use: `agent started`, `already handled`, `repair check`, `agent`, `watcher`.

## Design notes

- Surfaces touched: `plugins/paseo-nstack/**`, `e2e/paseo-nstack.e2e.mjs`, root `GLOSSARY.md`, `docs/design/**`, and one ADR.
- ADR candidate retained: keep decision-making in agents and make the plugin a thin watcher. This is hard to reverse, surprising without context, and chosen over real alternatives.
- ADR candidates dropped: vendoring skills and omitting plugin-side limits are both reversible; record them in the design instead.
- Historical prototypes: `proto/paseo-nstack` @ `d32f303` and `proto/paseo-nstack-clean-ui` @ `accd29a`. Their captures are obsolete; current UI evidence must come from the Issues-only implementation.
- Explicit non-goals: implement nstack rules in TypeScript; merge pull requests; schedule `lessons-ledger`; use GitHub webhooks; store a separate PAT; prompt for every event; send OS notifications; publish generative-ui cards.
- SDK constraint: `PaseoApi` is available only inside RPC and lifecycle callbacks, not at plugin setup. The watcher can poll immediately, but it must retain pending signals until the first callback supplies the daemon connection; the panel status call and all agent/workspace lifecycle events provide that connection.
