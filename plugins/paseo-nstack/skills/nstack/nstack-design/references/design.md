# Phase 2 reference: Design

Detail for [nstack-design](../SKILL.md) §2 and the design PR in §4 (formerly `orchestrate` Mode A, and before that the `design-first-feature` skill). The SKILL.md rules (HARD GATE, safeguards) win if this file and it ever disagree. Evidence base: vault `Digests/2026-10-08 Design-first feature gate.md`.

## Upstream

The design work **is** Matt Pocock's prototype / codebase-design / domain-modeling (plus to-tickets for slicing: [slicing-and-filing.md](slicing-and-filing.md)), run inside nstack. Read the upstream files (including every sibling `.md`) before you start and follow their mechanics. Where nstack and upstream disagree on _how to prototype, shape interfaces, write the glossary and ADRs, or slice_, upstream wins. nstack keeps: the transcript requirement, the HARD GATE, the budget STOP, the design doc template, and the design PR as the only sign-off. Each override is named below.

- [`prototype`](https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/SKILL.md) with [`LOGIC.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/LOGIC.md) and [`UI.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/UI.md): throwaway code that answers one design question.
- [`codebase-design`](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md) with [`DEEPENING.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/DEEPENING.md) and [`DESIGN-IT-TWICE.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/DESIGN-IT-TWICE.md): deep-module vocabulary, seam discipline, parallel alternative interfaces.
- [`domain-modeling`](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md) with [`GLOSSARY-FORMAT.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/GLOSSARY-FORMAT.md) and [`ADR-FORMAT.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/ADR-FORMAT.md): `GLOSSARY.md` and `docs/adr/`.

Pinned reading: mattpocock/skills `main` @ `b0618bc` (2026-10-08). If upstream has moved, re-read it; don't trust this summary.

### The upstream loops, in brief

**prototype**

1. Name the question first, then pick the branch: _"does this logic/state model feel right?"_ → LOGIC; _"what should this look like?"_ → UI. Ambiguous and nobody to ask → pick by surrounding code (backend module → logic, page/component → UI) and state the assumption at the top.
2. **LOGIC:** one self-contained HTML file, opened by double-click. The logic is a small pure module (reducer, state machine, or pure functions; no DOM) that could later lift into the real code. Around it: title + the question, a readable current-state panel re-rendered after every action, free-play buttons for every action, and tabbed guided walkthroughs (happy path, tricky edge, something that should be illegal), each starting from a reset state. Labels in domain language, for a non-developer.
3. **UI:** default 3 variants (cap 5), **structurally** different (layout, hierarchy, primary affordance; not colour). Strongly prefer mounting them on the existing page via `?variant=`, keeping its data fetching; a new throwaway route only when nothing can host it. A floating bottom switcher (arrows + label, ←/→ keys outside inputs, hidden in production builds). Read-only or stubbed mutations.
4. Both: clearly marked throwaway, one command to run, in-memory state, no tests or polish, state always visible. When done, capture the verdict and the question it settled, and keep the prototype on a throwaway branch outside main as a primary source.

**codebase-design**

1. Use its terms exactly: **module, interface** (everything a caller must know, not just types), **implementation, depth** (leverage per unit of interface), **seam, adapter, leverage, locality**. Avoid "component/service/API/boundary" in design prose.
2. Prefer deep modules: small interface, lots hidden. Apply the **deletion test**. The interface is the test surface. One adapter = hypothetical seam; two adapters = real seam.
3. **Deepening:** classify each dependency (in-process; local-substitutable; remote-but-owned → port + adapters; true external → injected port, mock adapter). Tests replace shallow-module tests rather than layering on top.
4. **Design it twice:** frame the problem (constraints, dependency categories, a rough illustrative sketch), then 3+ parallel independent drafts (upstream: sub-agents), each with a different constraint (minimal interface; maximum flexibility; trivial common caller; ports & adapters if relevant). Each returns interface (incl. invariants, ordering, errors), usage, what hides behind the seam, dependency strategy, trade-offs. Compare on depth, locality, seam placement, then give an opinionated recommendation (or hybrid).

**domain-modeling**

1. Challenge terms against `GLOSSARY.md`, sharpen fuzzy terms to one canonical word, stress-test with invented edge-case scenarios, and cross-check stated behaviour against the code.
2. `GLOSSARY.md`: context name + one-line purpose, then `**Term**:` one- or two-sentence definition of what it _is_, `_Avoid_:` rejected synonyms. Opinionated, project-specific terms only, no implementation details. Multi-context repos use `GLOSSARY-MAP.md` at the root pointing at per-context glossaries. Create lazily.
3. ADRs only when all three hold: **hard to reverse, surprising without context, a real trade-off**. `docs/adr/NNNN-slug.md`, next number after the highest existing one, created lazily. Body can be 1–3 sentences (context, decision, why); Status / Considered Options / Consequences only when they add value.

### Host-neutral translation

- Upstream's "call the Skill tool with X" and "spawn sub-agents" mean: read that skill's file and follow it; use whatever parallel helpers the host offers (or the pstack `architect`/`arena` multi-model sketch). No helpers → write the alternatives yourself, one constraint at a time, before comparing.
- Upstream's "ask the user if they're around" maps to a **gap round** in the Grill (one question at a time, appended to the transcript), never an ad-hoc question.

### nstack overrides (named)

- **No live user in the design loop.** Upstream prototype and design-it-twice show work to the user as it happens; domain-modeling challenges the user in conversation. In nstack the human was already grilled. Contradictions between transcript, glossary, and code go into **one gap round** (HARD GATE). Alternatives, comparison, and recommendation are written into the design doc and read at PR review.
- **Prototype findings fold into the design, not into code.** Upstream folds the validated decision into real code right away. nstack forbids implementation before the design PR merges, so the verdict becomes D-decisions and B-scenarios in the design doc (a trimmed decision-rich snippet is allowed), and the prototype lives on `proto/<feature>` linked by SHA. Filing carries that pointer onto the issues, which is upstream's "context pointer on the implementation issue".
- **Glossary and ADRs land in the design PR, not inline commits.** Upstream writes `GLOSSARY.md` the moment a term resolves. Here the terms were resolved in the grill transcript; you write them (and ADRs) as files in the design PR, so the owner's merge accepts them with the rest of the design.
- **Budget wording stays.** The STOP rule still counts "new classes/services" (nstack's rule). Use codebase-design vocabulary everywhere else.
- **3+ alternatives.** Upstream's design-it-twice minimum (3) replaces nstack's old "at least two".
- **No slicing quiz.** Upstream to-tickets quizzes the human and iterates before publishing. Here the slices are written into the design doc and reviewed slice by slice in the design PR; the merge approves them and is the permission to file. Phase 5 then files them as written.

## 1. Ingest transcript + ground

1. Read the full grill transcript. Lift Settled decisions, Deferred, Glossary, Design notes (surfaces, ADR candidates, prototype hints, non-goals).
2. Build a real model of every system the feature touches. Run pstack `how` over touched subsystems, and `why` when ownership or layering changes. Read existing `GLOSSARY.md` / `GLOSSARY-MAP.md` and `docs/adr/` in the touched area.
3. Constraints you found go in Problem. If a required decision is absent from the transcript and not deferred, or the transcript contradicts the code or glossary, **stop** and run one gap round. Don't re-grill the whole tree.

## 2. Prototype (only when a question hinges on behavior or UI)

Follow upstream `prototype` (LOGIC or UI branch). Scope it to the one decision it exists to make. No decision, no prototype. Prefer questions the transcript flagged as "prototype likely".

- Throwaway branch `proto/<feature>`, separate from production source. Link it by SHA in the design header.
- UI: variants on the existing page behind `?variant=` and the floating switcher. Logic: one double-click HTML file over a pure module. Do not fake the dimension being tested.
- Observe on the matching surface (screenshots for visual, logged state or timing for behavior).
- Turn what the prototype proved into 3–5 **behavior scenarios** (`B<n> WHEN … THE SYSTEM SHALL …`, with the evidence type each needs), and record the verdict + question in §3 Decisions.

## 3. Architect (pstack `architect`, checkpoint ON, codebase-design inside)

Always invoke as "architect **with checkpoint**". Default skips the human — here the checkpoint is the design PR the owner merges, not another grill round, unless budget STOP needs a cut decision (then one sharp question, asked per the grill rules).

- Usage first: caller's README snippet and 2–3 real call sites. Derive the type sketch from it.
- **Design it twice:** frame the problem, then 3+ radically different interface alternatives under the upstream constraints, briefed with codebase-design vocabulary and the project's `GLOSSARY.md` terms. Compare on depth, locality, seam placement; recommend one (or a hybrid). Screen against pstack `architect/references/design-red-flags.md`.
- Classify each dependency per DEEPENING; introduce a port only where two adapters are justified.
- Optional: `interrogate` on the sketch; `blast-radius` for the one safety fact.
- Optional scaffold commit: every new file and signature, `not implemented` bodies.

## 4. Complexity budget (the stop rule)

Count what the sketch implies: files touched, new files, new public symbols, new classes/services, new tables/migrations, new external deps, net non-test LOC, issue count. `GLOSSARY.md`, ADR files, and design assets under `docs/design/` are design artifacts and don't count.

**If the design touches 8+ files or adds 2+ new classes/services: STOP.** Propose concrete cuts and let the human pick one (one question, asked per the grill rules), or say an explicit "keep it". Then write the budget with tolerance (default +25% files/LOC).

## 5. Glossary and ADRs (domain-modeling, in the design PR)

- **GLOSSARY.md:** add every resolved term from the transcript's Glossary (and any the design introduced) in upstream format, into the right context (`GLOSSARY-MAP.md` if multi-context). Create it if absent. No implementation details.
- **ADRs:** take the transcript's ADR candidates (plus any from your alternatives comparison), re-apply the three-condition test, and write each survivor as `docs/adr/NNNN-slug.md` in upstream format. Drop candidates that fail a condition and say so in the PR body.
- Use the glossary terms in the design doc, the L/S names, and the scaffold.

## 5b. Design artifact (required in the design PR)

Every design PR must include **at least one reviewable artifact** so the human can see the intended behavior before merge, even when there is no prototype.

| Surface             | Minimum artifact                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI / API / library | Worked **example invocations** (stdin/stdout or request/response) for the happy path and the main error path, as a fenced block in the design doc and/or `docs/design/<feature>-artifact.md`. Prefer copy-pasteable commands.                                                                                                                                              |
| GUI / web           | At least one **screenshot** or short **recording** (≤30 s) of the intended UI (mock, annotated wire, or proto capture), committed under `docs/design/assets/<feature>/` and linked from the design doc. These are **signed design assets**: the owner's merge accepts them with the design, so they are exempt from pr-with-evidence's "never commit PR-only images" rule. |

Rules:

- The artifact illustrates the **settled** behavior from the transcript + design-proposed picks; it is not implementation.
- If a prototype exists, its capture counts as the artifact (link `proto/<feature>@sha` plus the screenshot/recording or CLI session log).
- Self-check fails without an artifact.
- CLI sessions use `$ command` lines followed by their output (` ```console `), with exit codes shown via `$ echo $?` or a trailing `# exit 1` on the `$` line, not `# stdout:` comment lines. When a prototype or scaffold can run, capture output from a real run (e.g. Showboat `exec`, or a VHS tape for terminal motion) and label it `prototype <branch>@<sha> run <date>` / `scaffold @<sha>`; otherwise label it `intended (spec)`. Never pass hand-typed output off as a run.
- **Origin** has no upload API: CLI → console block in the body; GUI → commit the capture under `docs/design/assets/<feature>/`, embed it by relative path, and name that path in the `<sub>Source:` line so a broken render still points somewhere. **GitHub** → the committed design asset, or `gh pr create|edit --body-file body.md --attach <file>` (see [pr-body.md](pr-body.md)). Never host on gists, new repos, releases, or external image hosts.
- **The artifact must also appear in the PR description** under `## Outcome`, inline, not only as a linked file and never inside `<details>`.

## 6. `docs/design/<feature>.md` template

Every section filled; no `TBD`. Header must cite the grill transcript path/SHA or its intake-folder path. §7 Slices follows [slicing-and-filing.md](slicing-and-filing.md) §1–3.

```markdown
# Design: <feature>

Issue: #<n> Grill: <path> @ <sha|date> Prototype: proto/<feature> @ <sha> | none Artifact: <path> | none Scaffold: <commit sha> | none
Glossary: GLOSSARY.md (+<n> terms) | none ADRs: docs/adr/<NNNN-slug>.md, … | none
Method: mattpocock/skills @ <sha> (prototype, codebase-design, domain-modeling, to-tickets)
Approved when this file's design PR is merged by the owner. Pin: <merge sha, filled after merge>

## 1. Problem and done

- Done predicate (falsifiable): …
- Non-goals / out of boundary: …
- Constraints found while grounding: …

## 2. Usage (caller's view, written first)

<snippet + 2–3 call sites>

## 3. Strategy

- Chosen shape: … Interface depth: … Seams: … (adapters: …)
- Alternatives (design it twice): <A — constraint — why not>; <B — …>; <C — …>
- Tradeoffs accepted: …
- Decisions: D1 … (session-settled: user-approved — …) # from transcript only
- Prototype verdict: <question> → <answer> (proto/<feature> @ <sha>)
- Design-proposed (not yet human-picked outside merge): P1 …

## 4. Code layout (the conformance contract)

| ID                                                                   | Path or glob | New/Mod | Owns |
| -------------------------------------------------------------------- | ------------ | ------- | ---- |
| L1                                                                   | …            | …       | …    |
| Public surface: S1 …                                                 |
| Allowed dependencies: …. Forbidden: ….                               |
| Layout rules file: …                                                 | none yet.    |
| Incidental allowlist: tests/**, fixtures/**, lockfiles, generated/** |

## 5. Complexity and budget

- Moving parts: …
- Risks / one-way doors: …; blast-radius fact: …
- Budget: files ≤ n · new files ≤ n · new public symbols = S-list · net LOC ≤ n · issues ≤ n
- Tolerance: +25% files/LOC. Gate result: …

## 6. Behavior scenarios

- B1 WHEN … THE SYSTEM SHALL … — evidence: …

## 7. Slices (to-tickets; count ≤ budget `issues`; merge = permission to file)

1. <Title>
   Blocked by: none | <slice n>
   Delivers: <end-to-end behavior>
   Design refs: L1, L2, S1, B1
   Seams: <interface> — catches … / misses …
   Verify: <the observation that would show it false>
   Type: AFK | HITL (<what the human must do>) · Checkpoint: yes | no

Unmapped L/S/B: none | <id — out of scope because …>

## 8. Open questions (empty or explicitly deferred before merge)

## Amendments

- A1 <date> <what> — why — cost if wrong — status: proposed | approved in PR #<n>
```

**Self-check before opening the PR:** no empty section, no `TBD`, L-table, S-list, budget, Slices (every L/S/B covered, count ≤ `issues ≤ n`, each slice with its own Seams/Type/Checkpoint), open questions empty or deferred, transcript cited (and committed or its intake-folder path named), every transcript Glossary term in `GLOSSARY.md`, every surviving ADR candidate written, **at least one design artifact** (§5b), PR body draft passes B1–B8 ([pr-body.md](pr-body.md)). If `check-design` CI exists, it must pass.
