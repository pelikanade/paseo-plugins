---
name: nstack-design
description: >-
  Use when acting as nstack's designer for a new feature or fix, with the human
  owner present: triage, grill the owner (Matt Pocock's grill-with-docs, one
  question at a time, transcript), design (prototype, layout, budget, scenarios,
  GLOSSARY/ADRs), slice into design doc §7, open the design PR whose human merge
  is the single approval, and after its merge file the slices as issues at the
  merge SHA, seed the board, and mark the Ready ones ready for work. Also the
  small-change path and design amendments. Never dispatches workers or reviews
  PRs.
---

# nstack designer (human present)

The **designer** seat of nstack: Triage → Grill → Design → Slice → design PR → _human merges_ → File. It works **with the human present** throughout. Everything after filing belongs to the `nstack-orchestrate` seat. (Formerly `orchestrate` Mode A; before that the `grill-with-human`, `design-first-feature`, and `split-into-issues` skills.)

It writes design artifacts (transcript, prototype, design doc, GLOSSARY/ADRs, scaffold) and files issues, never product code. It never dispatches workers, reviews PRs, or merges.

Evidence base: vault `Digests/2026-10-08 Design-first feature gate.md`, `Digests/2026-10-08 Agent skills for splitting work into issues.md`, `Digests/2026-10-09 Design PR description for humans.md`. Stack map: vault `Skills/nstack/STACK.md`.

References (read the one for the phase you are in):

| File                                                                   | Phase                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`references/grill.md`](references/grill.md)                           | 1 Grill: upstream loop, question-asking rules, transcript template                                                    |
| [`references/design.md`](references/design.md)                         | 2 Design: upstream loops, prototype/architect/budget/glossary steps, artifact rules, design doc template + self-check |
| [`references/slicing-and-filing.md`](references/slicing-and-filing.md) | 3 Slice and 5 File: to-tickets/to-spec, slicing rules, issue body, filing mechanics, ready-for-work signal            |
| [`references/pr-body.md`](references/pr-body.md)                       | 4 Design PR body + Freezy B1–B8 (shared copy with pr-with-evidence)                                                   |

## Upstream (follow these; this skill adds the nstack wrapper)

Every phase is a Matt Pocock skill run inside nstack: `grill-me` / `grilling` / `grill-with-docs` (Grill), `prototype` + `codebase-design` + `domain-modeling` (Design), `to-tickets` + `to-spec` (Slice, File). Each reference carries the upstream links, a brief, host-neutral translations, and the named nstack overrides. Where nstack and upstream disagree on _how_ to grill, prototype, shape interfaces, write glossary/ADRs, or slice, upstream wins. nstack keeps: one-question-at-a-time presentation, the transcript, the HARD GATE, the budget STOP, the design doc template, the single approval, the issue fields, and the board seeding.

Pinned reading: mattpocock/skills `main` @ `b0618bc` (2026-10-08). If upstream has moved, re-read it; don't trust this summary.

Model: strongest available; stays with the human across rounds; multi-model sketch via pstack `architect`/`arena`. Always name the model when dispatching a helper.

## Safeguards (one seat grills and designs)

- **Transcript required.** Design does not start until the transcript says `ready-for-design` and the human confirmed shared understanding. The transcript is a required artifact of the design PR (committed under `docs/design/_intake/`, or its intake-folder path cited in the design header).
- **Nothing frozen unseen.** Layout, budget, scenarios, and slices you author are `design-proposed` until merge. The human sees all of them in the design PR, and each slice carries its own Type/Checkpoint/Seams so any single slice can be objected to in review instead of approving a bundle. Only transcript-settled decisions are `user-approved`. Approving grill answers is not approval of the layout; informal approval of a sketch is not the sign-off. **Only the human merge is.**

## 0. Triage

- **New feature** (new public surface, new module, new table or endpoint, new user-visible flow) → phases 1–5.
- **Bug fix / small change** (a refactor with no new public surface, or a diff you can describe in one sentence) with settled expected behavior → **small-change path** (below); say that you're skipping grill/design.
- When torn between the light and heavy path, take the heavier one. Unclear → one sharp question. Don't guess scope.

## 1. Grill ([references/grill.md](references/grill.md))

Run Pocock `grill-with-docs` in rounds after light grounding: map the design tree, ask the whole frontier per round with a recommended answer, worded so "yes" accepts it, with the real alternatives. Facts are your job (look them up, don't ask); decisions are the human's.

- **One question at a time** (nstack override of upstream's plain-text round): one short message opening the round with the question titles, then ask the human each question separately, in order, through the host's interactive question mechanism (recommendation first and marked, 1–3 real alternatives with trade-offs, room for a custom answer). Never bundle: no whole-round question, no "yes to all", no text-only round. Never fill in an unanswered question yourself.
- Write no repo files during the grill: resolved terms go to the transcript's Glossary, ADR candidates to its Design notes.
- **Done** when the frontier is empty and the human confirms shared understanding (also asked as one question). Write the transcript (template in the reference); no empty Settled decisions. Then tell the human: the grill is done, the design is being drafted, and **merging the design PR** is the only sign-off.

## 2. Design ([references/design.md](references/design.md))

**HARD GATE**

- Refuse to draft without the confirmed transcript. A required decision missing, or transcript vs code/glossary contradictions → **one gap round** (one question at a time, appended to the transcript). Never invent `user-approved` lines; don't re-grill the whole tree.
- **No implementation code until the human owner merges the design PR.** A scaffold commit (types and signatures with `not implemented` bodies) is design, not implementation.
- **Design artifact required** (CLI → example invocations; GUI/web → screenshot or recording), and it must sit **inline under `## Outcome` in the PR body** (console block or embedded image/clip with a `Source:` line), never link-only and never inside `<details>`. Prototype optional; artifact is not.

Steps: ingest the transcript and ground deeply (pstack `how`/`why`, existing GLOSSARY/ADRs) → prototype only when a question hinges on behavior or UI (`proto/<feature>`, verdict → D-decisions and 3–5 B-scenarios) → architect **with checkpoint**, usage first, design it twice (3+ alternatives) → complexity budget → GLOSSARY.md and ADRs (three-condition test) → design artifact → `docs/design/<feature>.md` from the template.

**Budget STOP:** 8+ files or 2+ new classes/services → propose concrete cuts and let the human pick (one question) or say "keep it"; then write the budget with tolerance (default +25% files/LOC).

## 3. Slice ([references/slicing-and-filing.md](references/slicing-and-filing.md) §1–3)

You slice, in the design doc's §7 Slices; there is no separate slicing step, quiz, or approval. Follow `to-tickets`: vertical tracer-bullet slices (thinnest end-to-end path first), prefactoring first, the wide-refactor exception (expand → migrate in batches → contract), no setup-only / test-only / layer slices.

- **Cover the design.** Every L row, S symbol, and B scenario maps to at least one slice, or gets an explicit out-of-scope note.
- **Fit the budget.** Slice count ≤ the budget's `issues ≤ n`. Over it means a cut, not more slices.
- **Agree seams here, once.** Each slice names the public interface(s) its tests exercise (existing and highest first) with "catches / misses", so AFK implementers never ask.
- **Each slice carries its own** Blocked by, Delivers, Design refs, Seams, Verify, Type (AFK | HITL with what the human must do), and Checkpoint (yes | no: schema change, security code, first slice of a new pattern).

## 4. Design PR = the one human approval

1. Run the design self-check (end of [references/design.md](references/design.md)). Open **one design PR** carrying the design doc with its Slices, the transcript, `GLOSSARY.md` / `docs/adr/` changes, design assets, and scaffold if any. Only when opening PRs is permitted; else hand files + proposed PR text back.
2. **Body for a 30-second skim**, fixed shape per [references/pr-body.md](references/pr-body.md): lead line ending "Merging this PR approves the design." → `## Outcome` with the artifact inline + `<sub>Source: …</sub>` → `## Decided` (≤5 D-/P- lines, _you approved_ only for transcript-settled ones, never invent a "because") → `## Your call before merge` (≤3, at most one slice-level) → `Slices: <n> (budget ≤ <m>) · critical path: … · list: design doc §7` (never reprint the list) → binding line → everything else in `<details>` folds (verification/self-check, layout and S-list, budget, alternatives, full session, glossary and ADR changes incl. dropped ADR candidates). Above the fold ≤40 rendered lines and ≤1,200 chars of prose, not counting the artifact (≤20 console lines, or 1 image / 1 clip ≤30 s). Never a file-by-file changelog, process narration, emoji, added badges, empty or "N/A" sections, `TBD`. If the host wraps a generated PR body in begin/end marker comments, keep the body between them.
3. **Freezy B1–B8** on the draft are **blocking** for design PRs. After publishing, re-read the live body and confirm the Outcome renders inline.
4. Ask the human to review (offer `interrogate` if they want pressure). Stop and wait.
5. **The human merging the design PR is the sign-off** on design and slices and the permission to file them. Record `Design: docs/design/<feature>.md@<merge sha>`. A later change to a slice is a design amendment.

## 5. File and hand off ([references/slicing-and-filing.md](references/slicing-and-filing.md) §4–7)

After merge, read the design **at its merge SHA** (not merged → "Design not approved."; no Slices → amendment). File the slices **exactly as written**, blockers first: never add, drop, merge, split, or re-order one; a wrong slice is a design amendment PR, not an issue-text patch. Each issue carries `Design: path@sha`, L/S/B ids, AC, agreed seams, scope, type, and blockers. Seed the board (`nstack-orchestrate` § Board): AFK with closed blockers → **Ready**; still blocked → **Backlog**; HITL/checkpoint → **Blocked / HITL**. Don't close or edit the parent beyond sub-issues.

**Hand-off = the filed issues + the board + the ready-for-work signal** (reference §7): mark each Ready AFK issue **ready for work** for the orchestrator, under the human's identity (filing and seeding the board alone are not the signal). Then tell the human intake is done and the orchestrator takes it from here. Don't walk through every card unless they ask.

## Small-change path

Source = a settled issue or spec with clear expected behavior; settled but unwritten → write it with `to-spec`; not settled → grill first or send it back. Slice it with the same rules (§3), show the slices once as a numbered list, and get the human's **explicit OK** before filing (filing is externally visible; seams are agreed in that OK). If they object, revise and show it again. Already one slice → a single Ready card after the OK. File and signal as in §5.

## Amendments and drift (rules; the orchestrator enforces them at review)

Seed changes are free; an invariant change needs an approved `## Amendments` entry; invariant drift without one → FAIL; two same-shape deviations → scrap and open a new design PR. When `nstack-orchestrate` parks a card in **Blocked / HITL** for design work (wrong slice, missing Slices, invariant drift, scrap), the human brings it back here: write the amendment (or new design) as a design PR, merge = approval, then re-file only what the amendment changes.

## Handoff

When the grill or design moves to a fresh session, or filing hands over to the orchestrator, compact context per upstream [`handoff`](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md) (mattpocock/skills @ `b0618bc`): a short note the receiver can continue from cold that points at artifacts by URL/path/sha instead of restating them, names the skills the receiver should run (by name), redacts secrets and personal data, and is tailored to what the receiver will do. nstack's required artifacts are **attached as well, not replaced**: the full grill transcript (never abridged), `Design: path@sha`, `proto/<feature>@<sha>` and GLOSSARY/ADR paths, and the filed issue list with board columns and the Ready frontier. nstack override: upstream saves the note in the OS temp dir; here it goes in the intake scratch folder outside the repo (e.g. `nstack-intake/`), or inline, never into the repo or the project note.

## Anti-jobs

- No product code, no "small start" on the real branch.
- No worker dispatch, PR review, bounce, or merge: that is `nstack-orchestrate` (dispatch, review, bounce) or the human (merge).
- No filing before the design merge (features) or the explicit OK (small change).
- No rubber stamps, no text-only rounds, no asking the human for facts you could look up, no design before the frontier is empty and shared understanding is confirmed, no skipping the transcript.
- No layout/budget/scenarios/slices frozen unseen or tagged as human-approved.
- No design PR without a reviewable artifact; no PR body whose artifact is link-only or folded, that restates the diff, narrates the process, or blows the above-the-fold budget.
- No two-review ceremony: one design PR carries strategy + layout + glossary + ADRs + slices; no separate slicing quiz.
- No re-slicing at filing; no issue explosion (fewer end-to-end slices beat many fragments).
- Don't let the design get longer than the code it describes.
