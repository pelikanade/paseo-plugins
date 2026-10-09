---
title: nstack
date: 2026-10-09
tags: [skills, stack, nstack]
type: skill-map
aliases: [personal agent coding stack, nstack]
---

Domestic pack **nstack** (this folder). Each seat skill pins and follows an upstream (see its `## Upstream` section; pointers in [[Curated External Skills]]): mattpocock/skills @ `b0618bc`, luoling8192/create-pr-with-evidence-skill @ `ae59b8b`. Every seat compacts context per Pocock `handoff` and attaches nstack artifacts on top. Bot-store skill ids stay flat (`sand-workflow:<id>`). Learn seat [[nstack/lessons-ledger/SKILL|lessons-ledger]] lives in this folder (the bot-store copy is shared, so other bots can use it too).

Skills here: [[nstack/lessons-ledger/SKILL|lessons-ledger]], [[nstack/nstack-design/SKILL|nstack-design]] (designer; references: `grill.md`, `design.md`, `slicing-and-filing.md`, `pr-body.md`), [[nstack/nstack-orchestrate/SKILL|nstack-orchestrate]] (orchestrator), [[nstack/implementer/SKILL|implementer]] (worker), [[nstack/auto-reviewer/SKILL|auto-reviewer]] (review procedure the orchestrator runs), [[nstack/pr-with-evidence/SKILL|pr-with-evidence]]. Retired stubs: `orchestrate` (split into nstack-design + nstack-orchestrate on 2026-10-09) and `grill-with-human`, `design-first-feature`, `split-into-issues` (now phases of nstack-design). Bot-store ids: `sand-workflow:nstack-design`, `sand-workflow:nstack-orchestrate`. GitHub repos only (Issues + Projects). Both seat skills are platform-independent: they describe the roles only, not what runs them. nstack is not tied to Grok Bot; a Paseo plugin is under consideration as its runtime.

# nstack: map

Two seats, neither writes product code or merges. The **designer seat** ([[nstack/nstack-design/SKILL|nstack-design]]) works with you present: grill → design → slice → **design PR merge** (your one approval of design + slices) → files the issues at the merge SHA, seeds the board, and marks the Ready ones ready for work. The **orchestrator seat** ([[nstack/nstack-orchestrate/SKILL|nstack-orchestrate]]) handles one signal at a time, statelessly: dispatches Ready cards to implementer workers under max-parallel + LLM budget, reviews every returned PR, bounces, hands PASSes to you, closes the loop on merge. Design work found by the orchestrator goes to Blocked / HITL and back to the designer.

## Pipeline

```
DESIGNER SEAT: YOU present (nstack-design)
  brainstorm / name feature
       │
       ▼
  [1] Grill ── Pocock grill-with-docs rounds, one question at a time ── transcript
       │
       ▼
  [2] Design ── Pocock prototype + codebase-design + domain-modeling
         prototype + sketch + budget + GLOSSARY/ADRs + artifact
       │
       ▼
  [3] Slice ── Pocock to-tickets ── design doc §7 Slices (own Type/Checkpoint/Seams each)
       │
       ▼
  [4] Design PR (transcript + design + slices) ── YOU MERGE = the one approval ── Design: path@sha
       │
       ▼
  [5] File ── issues @ merge sha, blockers first, exactly as written ── seed board ── mark Ready issues ready for work
       │
       │    Backlog | Ready | In progress | In review | Merge queue | Done | Blocked/HITL
       ▼    (GitHub Project status + stack:* labels)
ORCHESTRATOR SEAT: one signal at a time (nstack-orchestrate)
  signals: issue ready for work | worker PR opened | worker PR updated | your review feedback | CI result | PR merged | PR closed | your command (drain/review/retry/park/approve) | [time: optional sweep]
  rebuild state from board + PRs + caps; duplicate signal = no-op
  pick Ready AFK, disjoint scope, under max-parallel + LLM budget
       │
       ▼
  WORKER: implementer ── Pocock implement + tdd ── PR + verification record
       │  worker PR opened / updated → orchestrator
       ▼
  REVIEW: auto-reviewer (run by orchestrator) ── Pocock code-review (Standards ∥ Spec) ── PASS / FAIL / INCONCLUSIVE
       │ FAIL → bounce ≤3 → Blocked/HITL     design work needed → Blocked/HITL → back to nstack-design
       ▼ PASS
  pr-with-evidence (luoling8192 create-pr-with-evidence) brief ── Merge queue
       │
       ▼
  YOU merge @ reviewed sha (--match-head-commit) ── PR merged: Done, unblock Backlog, next pick
       │
       ▼
  lessons-ledger (nightly; Pocock retro lenses) ← gate ledger, FAILs, Not-run, drift
```

## Caps

| Cap          | Default                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| max-parallel | 3 (ceiling 5); disjoint L-rows only                                     |
| LLM budget   | human-set daily/per-drain; else uncapped; park when next card won't fit |
| Bounce       | 3 → HITL                                                                |

## Who runs what

| Role                                                                      | Skill                                             | Upstream                                                                                                                               | When                                                    | Human gate                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Designer: triage → grill → design → slice → design PR → file + mark ready | `nstack-design` (you present)                     | Pocock `grill-with-docs`, `prototype` + `codebase-design` + `domain-modeling`, `to-tickets` (+ `to-spec` for small changes), `handoff` | New feature (or settled bug); design amendments         | **design PR merge** = design + slices + file permission (must carry the transcript and ≥1 artifact inline under `## Outcome`; body shape: `nstack-design/references/pr-body.md`, per [[2026-10-09 Design PR description for humans]]). Small change: your explicit OK before filing |
| Orchestrator: dispatch + review + bounce + hand-off                       | `nstack-orchestrate` (review via `auto-reviewer`) | drain ≈ `implement-spec` (nstack caps win); review = Pocock `code-review` two-axis                                                     | One signal at a time (see nstack-orchestrate § Signals) | merge queue; HITL; escalations; your commands                                                                                                                                                                                                                                       |
| Worker                                                                    | `implementer`                                     | Pocock `implement` + `tdd`                                                                                                             | Per Ready AFK card                                      | none (stops on drift)                                                                                                                                                                                                                                                               |
| PR evidence / brief                                                       | `pr-with-evidence`                                | luoling8192 `create-pr-with-evidence`                                                                                                  | Author in worker PRs; brief after PASS                  | **you merge**                                                                                                                                                                                                                                                                       |
| Learn                                                                     | `lessons-ledger`                                  | Pocock `retro` lenses                                                                                                                  | Nightly                                                 | owner decisions                                                                                                                                                                                                                                                                     |

**Safeguard (the designer grills and designs):** the grill transcript is required before design and ships with the design PR; everything the designer authored (layout, budget, scenarios, slices) is `design-proposed` and visible in the PR, and each slice has its own Type/Checkpoint/Seams so you can object to any one. Only your merge approves. The orchestrator can't design: it parks design problems in Blocked / HITL for an nstack-design amendment.

## How the seats are run

## Contract chain

1. Grill transcript → design (designer; transcript attached to the design PR)
2. `docs/design/<feature>.md` (incl. Slices) @ merge SHA
3. Issue / card: `Design: path@sha` + L/S/B + AFK/HITL + blockers, filed by the designer; Ready issues marked ready for work (= the hand-off signal)
4. Worker PR (dispatched by the orchestrator): same pin + verification record @ head
5. Orchestrator auto-review @ head
6. Reviewer brief @ head + merge command
7. Ledger line → lessons

Drift without approved Amendments → FAIL. Two same-shape deviations → scrap (new design PR via nstack-design).

## Gaps still open

- project-pm anti-job vs workers opening PRs (one permission line)
- No deterministic design-conformance CI yet
- INCONCLUSIVE without CI / `verify-*`
- Concurrent signal handling can race on a card; claim-first + re-read narrows it, nothing makes it atomic
- Box `gh` 2.46 vs blocked-by 2.94
