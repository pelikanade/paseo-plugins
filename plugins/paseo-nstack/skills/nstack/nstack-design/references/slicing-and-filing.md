# Phases 3 and 5 reference: Slice and File

Detail for [nstack-design](../SKILL.md) §3 and §5 (formerly `orchestrate` Mode A, and before that the `split-into-issues` skill). The SKILL.md rules win if this file and it ever disagree. **One issue = one implementer slice = one PR.** Evidence base: vault `Digests/2026-10-08 Agent skills for splitting work into issues.md` (mirrors mattpocock `to-tickets`, plus AgentiveStack `slice` and Every `ce-plan` unit fields).

## Upstream

Slicing **is** Matt Pocock's `to-tickets`; `to-spec` covers the small-change path that has no written spec yet. Read both before you start and follow their mechanics. Where nstack and upstream disagree on _how to slice or publish_, upstream wins. nstack keeps: the settled-source precondition, design coverage and budget, AFK/HITL typing, the single approval, the issue body fields, GitHub Issues as the sole tracker, and canonical workflow labels. Each override is named below.

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
6. **Publish** blockers-first so edges cite real ids, with blocking links and sub-issues of the source issue. Work the **frontier** (issues whose blockers are all done). Never close or modify the parent. In nstack, publish to GitHub Issues and apply the workflow labels in §6.
7. No file paths or code in tickets, except a trimmed decision-rich prototype snippet, marked as such.

**to-spec**

1. Synthesize from what's already known; **don't interview**.
2. Sketch the **test seams**: prefer existing seams, the highest one possible, as few as possible (ideally one). Check them with the human.
3. Write the spec (Problem Statement, Solution, a long list of user stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes), no file paths, and publish it as a GitHub issue with its nstack workflow label after the approval below.

### Host-neutral translation

- Upstream's "tell the user to run `/setup-matt-pocock-skills`" is a Claude-Code slash command. In nstack, use GitHub Issues and the fixed workflow labels in [nstack-orchestrate § Issue workflow](../../nstack-orchestrate/SKILL.md#issue-workflow); create missing labels under the run's existing write permissions.
- `disable-model-invocation` on upstream means it is human-invoked there. In nstack the design merge (or the small-change OK) is the invocation.

### nstack overrides (named)

- **Source = merged design at its SHA.** Upstream slices whatever is in context. For features nstack slices inside `docs/design/<feature>.md` (§7 Slices) and files from it at its merge SHA.
- **No quiz; the design merge is the one approval.** Upstream quizzes the human before publishing. nstack: the owner reviews each slice in the design PR, and merging it approves the slices and permits filing. Only the small-change path (no design PR) keeps one lightweight confirmation before filing.
- **to-spec only for the small-change path.** For features the design doc _is_ the spec; don't write a second one. For a bug fix / small change whose settled behaviour lives only in conversation, use to-spec to write the spec issue first, and publish it only after the human's explicit OK (filing is externally visible).
- **Seams are agreed once, before filing.** to-spec's seam check (and tdd's "test only at pre-agreed seams") happens in the design PR's Slices section (small change: in the confirmation), so AFK implementers never have to ask. Each issue carries its agreed seams.
- **Readiness is explicit.** Only AFK issues with closed blockers and cleared checkpoints receive `stack:ready`; HITL/uncleared checkpoint receive `stack:hitl`; still-blocked issues receive `stack:backlog`. The Ready label itself is the hand-off signal.
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
- Create missing canonical labels and set the issue workflow state using [nstack-orchestrate § Issue workflow](../../nstack-orchestrate/SKILL.md#issue-workflow). AFK with closed blockers and cleared checkpoints → **Ready** (`stack:ready`); still blocked → **Backlog** (`stack:backlog`); HITL/uncleared checkpoint → **Blocked / HITL** (`stack:hitl`). Replace only the prior workflow label, preserving unrelated category labels. Multiple workflow labels require human resolution and prevent dispatch.
- If GitHub issue or label writes are unavailable, report the missing access and which issues remain unfiled or unclassified. GitHub Issues are the sole tracker; keep the approved slices in the design until filing is possible.
- Do not close or edit the parent issue beyond adding sub-issues.

Record the filed list with numbers, types, workflow states, and the **Ready** frontier; the drain starts from it. `project-map` can summarize the issues if the human wants a status page.

### 7. Confirm the Ready hand-off

An open issue labeled `stack:ready` automatically signals `nstack-orchestrate`. Filing and labeling the Ready frontier completes the hand-off; no extra command or human-identity action is required.

- Re-read each filed issue and confirm exactly one canonical workflow label. Backlog issues become Ready when their blockers close and checkpoints are cleared; HITL issues require the human's resolution first. Closed issues never enter the Ready frontier.
- With an enabled Paseo binding, the read-only watcher detects Ready label events and dispatches each occurrence once, subject to pause and exact-duplicate protection. Unrelated edits must not create another Ready start. The orchestrator still enforces design approval, AFK/checkpoint gates, caps, and review policy.
- If the binding is paused or unavailable, report the filed Ready issues and the watcher state. The human can resume/configure the binding or invoke `drain`; do not reapply labels merely to force another start.
- Never dispatch a worker yourself.
