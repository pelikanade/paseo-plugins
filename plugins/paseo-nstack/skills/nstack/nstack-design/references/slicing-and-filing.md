# Phases 3 and 5 reference: Slice and File

Detail for [nstack-design](../SKILL.md) §3 and §5 (formerly `orchestrate` Mode A, and before that the `split-into-issues` skill). The SKILL.md rules win if this file and it ever disagree. **One issue = one implementer slice = one PR.** Evidence base: vault `Digests/2026-10-08 Agent skills for splitting work into issues.md` (mirrors mattpocock `to-tickets`, plus AgentiveStack `slice` and Every `ce-plan` unit fields).

## Upstream

Slicing **is** Matt Pocock's `to-tickets`; `to-spec` covers the small-change path that has no written spec yet. Read both before you start and follow their mechanics. Where nstack and upstream disagree on _how to slice or publish_, upstream wins. nstack keeps: the settled-source precondition, design coverage and budget, AFK/HITL typing, the single approval, the issue body fields, and the kanban seeding. Each override is named below.

- [`to-tickets`](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md): plan → tracer-bullet tickets with blocking edges, quiz, publish blockers-first.
- [`to-spec`](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md): conversation → spec by synthesis (no interview), with agreed test seams.

Pinned reading: mattpocock/skills `main` @ `b0618bc` (2026-10-08). If upstream has moved, re-read it; don't trust this summary.

### The upstream loop, in brief

**to-tickets**

1. Gather context: read the passed reference (spec, issue) in full, body and comments.
2. Explore (light): use the project's glossary vocabulary in titles, respect ADRs in the touched area, look for **prefactoring** ("make the change easy, then make the easy change").
3. Draft **vertical slices**: each a narrow but complete path through every layer, demoable or verifiable alone, sized for one fresh context window, prefactoring first. Give each its **blocking edges**.
4. **Wide refactors** are the exception: expand (new form beside old) → migrate in batches sized by blast radius, each its own ticket blocked by the expand → contract once no caller remains, blocked by every batch. If batches can't stay green alone, they share an integration branch that blocks one final integrate-and-verify ticket.
5. **Quiz** the human with a numbered list (title, blocked by, what it delivers): granularity, edges, merge/split. Iterate until approved. (nstack: replaced by design PR review; see overrides.)
6. **Publish** blockers-first so edges cite real ids: native blocking links where the tracker has them, sub-issues of the source issue, the `ready-for-agent` label; or one file per ticket when there is no tracker. Work the **frontier** (tickets whose blockers are all done). Never close or modify the parent.
7. No file paths or code in tickets, except a trimmed decision-rich prototype snippet, marked as such.

**to-spec**

1. Synthesize from what's already known; **don't interview**.
2. Sketch the **test seams**: prefer existing seams, the highest one possible, as few as possible (ideally one). Check them with the human.
3. Write the spec (Problem Statement, Solution, a long list of user stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes), no file paths, and publish it as a ready-for-agent issue.

### Host-neutral translation

- Upstream's "tell the user to run `/setup-matt-pocock-skills`" (tracker + label config) is a Claude-Code slash command. In nstack the tracker and labels are fixed by the kanban rules; never stop to ask for setup.
- `disable-model-invocation` on upstream means it is human-invoked there. In nstack the design merge (or the small-change OK) is the invocation.

### nstack overrides (named)

- **Source = merged design at its SHA.** Upstream slices whatever is in context. For features nstack slices inside `docs/design/<feature>.md` (§7 Slices) and files from it at its merge SHA.
- **No quiz; the design merge is the one approval.** Upstream quizzes the human before publishing. nstack: the owner reviews each slice in the design PR, and merging it approves the slices and permits filing. Only the small-change path (no design PR) keeps one lightweight confirmation before filing.
- **to-spec only for the small-change path.** For features the design doc _is_ the spec; don't write a second one. For a bug fix / small change whose settled behaviour lives only in conversation, use to-spec to write the spec issue first, and publish it only after the human's explicit OK (filing is externally visible).
- **Seams are agreed once, before filing.** to-spec's seam check (and tdd's "test only at pre-agreed seams") happens in the design PR's Slices section (small change: in the confirmation), so AFK implementers never have to ask. Each issue carries its agreed seams.
- **Not every ticket is `ready-for-agent`.** Upstream labels all tickets agent-grabbable. nstack: only AFK with closed blockers go to **Ready**; HITL/checkpoint go to **Blocked / HITL**; still-blocked go to **Backlog**.
- **Design IDs, not prose-only.** Issues cite L/S/B ids from the pinned design (paths live there), consistent with upstream's no-paths rule.
- **Budget caps slice count.** Upstream has no ceiling; nstack's `issues ≤ n` does.

## Slicing (§1–3: feature path in the design doc; small-change path before the OK)

Read the full source, plus the parent issue body and comments, `GLOSSARY.md`, and ADRs in the touched area.

### 1. Explore (light)

Look at the touched code for **prefactoring** that makes the slices easier. Use the repo's domain vocabulary (`GLOSSARY.md`) in titles.

### 2. Draft vertical slices

- Each slice cuts a narrow but **complete** path through every layer it needs (schema, API, UI, tests). Vertical, not one layer.
- The first slice is the thinnest end-to-end path (the tracer bullet). Later slices add breadth, edge cases, polish.
- Each slice is demoable or verifiable on its own and fits in **one fresh context window**. If it would take a person more than a day, split it.
- Prefactoring slices go first.
- **Wide refactor exception:** expand → migrate in batches → contract, each batch its own issue (integration branch + final integrate-and-verify issue when batches can't stay green alone).
- **Cover the design.** Map every L-row, S-symbol, and B-scenario to at least one slice. Anything unmapped is either a missing slice or an explicit "out of scope" note.
- **Respect the budget.** Slice count must fit the design's `issues ≤ n`. Over that means a cut or a design amendment, not more issues.
- **Name the seams.** For each slice, the public interface(s) its tests will exercise: existing and highest first, each with a one-line "catches / misses".

Anti-patterns: setup-only slices ("set up infra"), test-only slices (tests belong in each slice), layer slices (all backend, then all frontend), twelve issues for a three-line change. If every issue has a blocker, the slicing is wrong.

### 3. Type each slice

- **AFK**: a worker can implement it without human input. Prefer these.
- **HITL**: needs a human decision, design review, credentials, or an external action. Name what's needed. HITL issues wait for the human; the orchestrator's drain won't dispatch them.
- **Checkpoint flag**: mark slices that must pause for the human even if AFK (schema change, security code, the first slice of a new pattern).

Small-change confirmation list (same fields as design doc §7):

```
1. <Title>
   Blocked by: none
   Delivers: <end-to-end behavior>
   Design refs: L1, L2, S1, B1   (small change: none)
   Seams: <interface> — catches … / misses …
   Verify: <the observation that would show it false>
   Type: AFK | HITL (<what the human must do>) · Checkpoint: yes | no
```

## Filing (§4–6)

### 4. Precondition

- **Feature:** source is `docs/design/<feature>.md` at its **merge SHA**. Read it with the SHA as ref, never the moving branch. Not merged → stop: "Design not approved." No Slices section → stop and open a design amendment.
- **Bug fix / small change:** a settled issue or spec with clear expected behavior (to-spec if settled but unwritten), plus the human's explicit OK on the numbered list. Not settled → grill first or send it back. Don't invent scope.

File each slice exactly as written: never add, drop, merge, split, or re-order one. If a slice is wrong (edge, coverage, type, seam), stop and raise a design amendment (`## Amendments`, approved in a new design PR), not a quiz, and don't paper over it in issue text.

### 5. Issue body

```markdown
## Parent

#<feature issue>

## Design

Design: docs/design/<feature>.md@<merge sha>
Sections: L1, L2 · S1 · B1 (IDs, not raw paths: paths live in the pinned design)
Prototype: proto/<feature>@<sha> (verdict: …) | none

## What to build

End-to-end behavior from the user's view, not a layer-by-layer list.

## Acceptance criteria

- [ ] <criterion> — falsified by: <observation>, which fails at the starting commit
- [ ] B1 holds: <evidence type>

## Test seams (agreed in the design PR's Slices, or the small-change OK)

- <interface> — catches … / misses …

## Test scenarios

- happy path · edge · error · integration (only the ones that apply)

## Scope

Allowed to touch: L1, L2 (+ incidental allowlist). Not allowed: tests/AC/CI/layout-rules edits unless listed here.

## Type

AFK | HITL (<what the human must do>) · Checkpoint: yes | no

## Blocked by

- #<n> (omit when native blocking edges were set)
```

Keep file paths and code out of the body except via design IDs, or a decision-rich snippet from the prototype (state machine, type shape), marked as such.

### 6. File, blockers first

Publish in dependency order so later issues can cite real numbers.

- GitHub: create the issue (`create_issue`), attach it under the parent (`add_sub_issue`), add native blocked-by edges where the tooling supports it (`gh issue create --blocked-by` on gh ≥ 2.94, or `gh api --method POST repos/<o>/<r>/issues/<n>/dependencies/blocked_by -F issue_id=<db id>`); otherwise write "Blocked by" in the body.
- Seed the nstack kanban: the repo's GitHub Project (one per repo or feature epic) status column, with labels of the same names as fallback. AFK with closed blockers → **Ready** (`stack:ready`); still blocked → **Backlog**; HITL/checkpoint → **Blocked / HITL** (`stack:hitl`). Also apply any repo `ready-for-agent` label the project uses, on Ready cards only.
- No tracker at all: write one file per issue under `.scratch/<feature>/issues/NN-<slug>.md` (or the project's agreed folder), numbered blockers-first, with the same column tags in frontmatter.
- Do not close or edit the parent issue beyond adding sub-issues.

Record the filed list with numbers, types, board columns, and the **Ready** frontier; the drain starts from it. `project-map` can render the board if the human wants a status page.

### 7. Mark Ready issues ready for work (the hand-off signal)

Filing an issue and seeding its column are not, by themselves, the signal `nstack-orchestrate` acts on. After the board is seeded:

- **Mark each Ready AFK issue as ready for work** for the orchestrator, under the human's identity (the orchestrator acts only on the human's own ready signal). Ready cards only: Backlog cards become Ready when their blockers merge (the orchestrator promotes them when the blocking PR merges), and HITL cards are marked ready by the human once resolved.
- If you can't mark them (no write access for that identity, or the repo isn't set up for the orchestrator yet), tell the human the cards are filed and that the orchestrator picks them up on its next signal, on the human's `drain` command, or on the optional periodic sweep.
- Never dispatch a worker yourself.
