---
name: implementer
description: >-
  Use when dispatching a plain coding agent (often a smaller/cheaper model) to
  implement exactly one issue, or when you are that agent: read the issue and
  Design: <path>@<sha>, build test-first per Matt Pocock's implement + tdd at the
  issue's agreed seams in a fresh branch/worktree, open one PR with a
  verification record, no redesign, stop on budget or invariant drift.
---

# Implementer

A plain agent call per issue. No harness, no sub-orchestration. The issue body plus the pinned design is the whole brief.

Stack map: vault `Skills/nstack/STACK.md`.

## Upstream (follow these; this skill only adds the nstack wrapper)

The build loop **is** Matt Pocock's `implement` + `tdd`, run inside nstack for one issue. Read the upstream files (including tdd's siblings) before your first change and follow their mechanics. Where this skill and upstream disagree on _how to write the code and tests_, upstream wins. This skill keeps what is nstack's: one issue per run, the scope and stop rules, the design self-check, causation evidence, and the PR contract. Each override is named below.

- [`implement`](https://github.com/mattpocock/skills/blob/main/skills/engineering/implement/SKILL.md): build a ticket or spec, test-first at agreed seams, with a steady check cadence.
- [`tdd`](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md) with [`tests.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/tests.md) and [`mocking.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/mocking.md): the red → green loop and what makes a test worth keeping.
- [`implement-spec`](https://github.com/mattpocock/skills/blob/main/skills/engineering/implement-spec/SKILL.md): the multi-ticket driver. In nstack its role is played by the orchestrator's [nstack-orchestrate](sand-workflow:nstack-orchestrate) drain, with the overrides listed below; this worker agent is one of its "implementer subagents".

Pinned reading: mattpocock/skills `main` @ `b0618bc` (2026-10-08). If upstream has moved, re-read it; don't trust this summary.

### The upstream loop, in brief

1. **Fetch the ticket** and state its title before starting; ask if the reference is ambiguous.
2. **Seams first.** Tests live only at pre-agreed seams: public interfaces where behaviour is observable without reaching inside. Each seam carries a one-line note on what it catches and misses. When the interface's shape is itself in question, use codebase-design vocabulary (module, interface, depth, seam, adapter).
3. **Red → green, one vertical slice at a time:** one seam, one failing test, the minimum code to pass it, then the next test. No bulk "all tests first" (horizontal slicing), no speculative features. Refactoring is not part of the loop; it belongs to review.
4. **Good tests** verify behaviour through the public interface and read like a spec ("user can checkout with valid cart"), survive internal refactors, and make one logical assertion. Bad tests: implementation-coupled (mock internals, test private methods, assert call counts, verify through the database instead of the interface) or **tautological** (expected value recomputed the way the code does). Expected values come from an independent literal, worked example, or the spec.
5. **Mock only at system boundaries** (external APIs, sometimes DB/filesystem, time/randomness), never your own modules. Inject dependencies; prefer SDK-style per-operation functions over one generic fetcher.
6. **Cadence:** typecheck regularly, run single test files regularly, the full suite once at the end.
7. Then review (upstream: code-review) and commit to the current branch.

implement-spec adds: tickets form a **task graph** with a ready **frontier**; communicate through **context pointers** (spec, tickets, notes, commits), not duplicated text; each implementer works in its own worktree on its own branch.

### Host-neutral translation

- Upstream's "call the Skill tool with `tdd` / `code-review`" is Claude-Code wording: read and follow that skill's file. `disable-model-invocation` (human-only invocation upstream) maps to: the orchestrator's dispatch is the invocation.
- "Ask the user" (ambiguous ticket, unconfirmed seam) becomes a report status, because this worker is AFK (see overrides).

### nstack overrides (named)

- **No self-review step.** Upstream `implement` ends by running code-review on its own work (which spawns sub-agents). nstack forbids spawning reviewers and self-certification: the orchestrator runs that same two-axis review ([auto-reviewer](sand-workflow:auto-reviewer)) at your head SHA when the PR comes back. Stop after the PR and report.
- **Seams come from the issue, not a live question.** tdd says confirm seams with the user before any test. In nstack the human approved them per slice in the design PR (or the small-change OK); use the issue's "Test seams". If the issue names none, use the highest existing public interface the AC exercise and record it in the PR as "seam chosen by implementer (not pre-agreed)". If no existing seam covers the AC, report NEEDS_CONTEXT instead of inventing one.
- **Ambiguity → NEEDS_CONTEXT**, not a question to the human.
- **Own branch + one PR, not "commit to current branch".** Never the default branch; never merge.
- **Causation evidence on top of red → green.** Keep nstack's stash check (fail without the fix, pass with it) in the verification record; red-first in the loop is necessary but not the evidence the reviewer reads.
- **implement-spec's integration branch, merger subagent, and single fix-all pass are not used.** Each issue is its own PR to the default branch, merged by the human at the reviewed SHA; fix rounds come back through the orchestrator's bounce.
- **"Don't edit tests you didn't write" stays.** tdd's refactor-at-review advice never licenses touching existing tests outside the issue's Scope.

## A. Dispatching (orchestrator side: [nstack-orchestrate](sand-workflow:nstack-orchestrate))

One agent per issue, on its own branch or worktree, explicitly picking the model (an omitted model inherits the caller's). Communicate by context pointers (issue URL, Design@sha, section ids), not pasted design text. Paste this prompt, filled in:

```text
Implement issue <repo>#<n>. Read the issue body and comments in full and state its title.
Design: <path>@<sha> — read it at that SHA. Sections for this issue: <L/S/B ids>.
Test seams (agreed in the design PR): <seams from the issue>.
Model tier for this run: <cheap | mid | strong>. Branch: <prefix>/<n>-<slug>.
Method: follow mattpocock/skills @ <sha> implement + tdd (red → green per seam).

Rules:
- Build only what the issue asks, inside its Scope. No redesign.
- Tests only at the agreed seams, through public interfaces; mock only at
  system boundaries; no tautological expectations.
- Do not edit tests you didn't write for this issue, the acceptance criteria,
  CI config, or layout-rule files, unless the issue lists them.
- Do not spawn reviewers or other agents, and don't run a self code-review.
- If you need a new public symbol, a new dependency edge or external dep, a
  file outside the design layout, or you'd exceed the budget tolerance:
  stop, add a *proposed* entry under the design's ## Amendments, and report
  BLOCKED or DONE_WITH_CONCERNS. Do not just do it.
- Open one PR. Its body follows the pr-with-evidence skill and must include
  the line `Design: <path>@<sha>` (or `Issue: #<n>` when there is no design),
  `Closes #<n>`, and a Verification record at the head you pushed.
- End with a report: status DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT |
  BLOCKED, PR URL, head SHA, files changed, seams tested, what you ran and
  what you did not.
```

Routing default: complete spec touching 1–2 files → cheap; prose spec or several files → mid; anything needing design judgment → it shouldn't be an implementer issue (Blocked / HITL; the human takes it back to [nstack-design](sand-workflow:nstack-design)). Cheap models often take 2–3× the turns on multi-step work, so mid-tier is the usual floor.

Mechanics vary by platform (cloud agent API with auto-PR, a local worktree agent, a CLI agent). Use whatever this environment provides; launching an agent run is an action the human must have allowed for this run.

## B. Doing the work (worker side)

1. **Read** the issue, its comments, and the design at the pinned SHA; state the issue title. Read the repo's `AGENTS.md` / `LESSONS.md` / standards file and `GLOSSARY.md` (test and symbol names use its terms) and ADRs in the touched area if present.
2. **Branch** from the current default branch (or the stated base for stacked work). Never work on the default branch.
3. **Prove the oracle first (red).** For each acceptance criterion, write or find the test at an agreed seam that fails today. Run it and see it fail for the right reason.
4. **Implement** the smallest change that makes that test pass (green), then take the next criterion: one seam, one test, one minimal change per cycle, inside the issue's Scope. Fill in scaffold bodies if a scaffold commit exists; add no public surface beyond the S-list. Typecheck and run the single test file as you go.
5. **Verify.** Run the checks fresh: focused tests (confirm N > 0 tests ran), the full suite once, typecheck, lint, the repo's `verify-*` skill for user-facing paths. For each behavior change, show it fails without the fix (`git stash -- <fix files>` → FAIL, restore → PASS). A compile error or zero tests selected is not a FAIL.
6. **Self-check against the design** before pushing: changed paths ⊆ L-rows + incidental allowlist; new exports ⊆ S-list; within budget tolerance. If not, see the stop rule.
7. **Push and open the PR** with [pr-with-evidence](sand-workflow:pr-with-evidence). Record the head SHA you verified; if you push again, re-verify and update the record.
8. **Report** in the format above. Claims in your report are claims; the reviewer checks them.

## Stop rule

Stop and report instead of improvising when:

- the issue is ambiguous in a way that changes behavior, or no existing seam covers the AC (NEEDS_CONTEXT),
- the work needs an invariant change from the design's amendment rules (new public surface, new dependency edge, out-of-layout file, over budget, changed scenario),
- you'd have to edit tests, AC, CI, or layout rules to get green,
- an action is irreversible, security-sensitive, or outside this branch (merge, push to a shared branch, publish).

## Fix rounds

When the orchestrator sends findings back, address each one, re-run the affected checks, push, update the verification record to the new head, and reply per finding: ADDRESSED (with evidence) or NOT ADDRESSED (with reason). Don't argue severity in the code; argue it in the reply.

## Handoff

When this worker passes work back to the orchestrator for review, to a fix round, or a fresh agent (including when you run out of context mid-issue), compact context per upstream [`handoff`](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md) (mattpocock/skills @ `b0618bc`): a short note a fresh agent can continue from that points at artifacts by URL/sha instead of restating them, names the skills the next agent should run, and redacts secrets and personal data. nstack's required artifacts are **attached as well, not replaced**: the issue brief (`<repo>#<n>`), `Design: path@sha` + section ids, the PR URL and head SHA, the verification record, and your status report. nstack override: upstream saves the note in the OS temp dir; here it goes inline in your report or on the box under `/workspace/nstack-intake/`, never into the repo.

## Anti-jobs

- No redesign, no opportunistic refactors, no "while I'm here" changes.
- No self-certification: never write "reviewed" or "approved" on your own work.
- No merging.
