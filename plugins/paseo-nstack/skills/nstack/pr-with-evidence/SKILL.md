---
name: pr-with-evidence
description: >-
  Use when opening or preparing a PR whose reviewer must be able to verify it
  (exact base...head, change map, behavior diagrams, invariant→evidence table,
  verification record at the head SHA, before/after screenshots, design link),
  following luoling8192/create-pr-with-evidence-skill, or when assembling a
  reviewer brief that helps a human review an agent PR that already passed
  automated review. Body is skim-first per references/pr-body.md (lead line,
  Outcome at head SHA, Deviations, Where to look, verification folded).
---

# PR with evidence

Make a PR a human can review fast and trust: every claim points at code, a command's output, or a named gap. Two modes:

- **Author mode:** you are opening the PR (usually an implementer).
- **Reviewer-brief mode:** the PR exists and passed the orchestrator's ([nstack-orchestrate](sand-workflow:nstack-orchestrate)) [auto-reviewer](sand-workflow:auto-reviewer) review; you collate what the human needs to decide. You don't review it again.

Verification record from vault `Digests/2026-10-08 Agent verification skills.md` §3. Body shape and media rules from vault `Digests/2026-10-09 Design PR description for humans.md`, distilled in the shared [`references/pr-body.md`](references/pr-body.md) (byte-identical copy of `nstack-design/references/pr-body.md`; edit both or neither). Stack map: vault `Skills/nstack/STACK.md`.

## Upstream (follow this; this skill only adds the nstack wrapper)

Author mode **is** luoling8192's `create-pr-with-evidence`, run inside nstack. Read the upstream files before you open a PR and follow their mechanics. Where this skill and upstream disagree on _how to build the evidence and the body_, upstream wins. This skill keeps what is nstack's: the design binding lines, the head-pinned verification record, the conformance self-report, publish permissions, and reviewer-brief mode. Each override is named below.

- [`SKILL.md`](https://github.com/luoling8192/create-pr-with-evidence-skill/blob/main/SKILL.md): workflow, context evidence, body contract, behavior / boundary / visual evidence workflows.
- [`references/pr-body.md`](https://github.com/luoling8192/create-pr-with-evidence-skill/blob/main/references/pr-body.md): the body template as a decision guide (diagram shapes, Before/After pairs, risk groups, evidence types).
- License MIT; forked from the [moeru-ai/airi `create-pr`](https://github.com/moeru-ai/airi/tree/main/.agents/skills/create-pr) skill (original by @nekomeowww, extended by @luoling8192, AIRI-specific Vishot steps removed).

Pinned reading: luoling8192/create-pr-with-evidence-skill `main` @ `ae59b8b` (2026-10-08). If upstream has moved, re-read it; don't trust this summary.

### The upstream loop, in brief

1. **Repository rules first**: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, the PR template, and any repo-owned screenshot/upload/check scripts win over the skill.
2. **Context brief (read-only):** repo, target, head, merge base, exact `base...head`; stacked parent named and inherited changes kept out; runtime code split from generated files, lockfiles, snapshots, migrations; changed files traced to entry points, callers, state owners, persistence, external boundaries; unproven intent marked as an assumption.
3. **Classify** (feature / fix / refactor / maintenance) and pick only the evidence that helps.
4. **Behavior evidence** (runtime changes only): list changed scenarios with stable IDs; pick the smallest form per scenario (prose, module flow, sequence, state diagram); comparable **Before/After** for a fix that changes a flow or state model; cover every scenario or name it unverified; arrows labelled with real calls/events, `alt` branches matching code branches.
5. **Boundary mapping:** start from inputs and side effects, then failure, retry, duplicates, concurrency, ordering, authz, cleanup, migration, rollback; map each high-risk invariant to a test, CI check, or named gap. Green CI proves only its configured checks.
6. **Body contract:** `Summary` and verification always; change map, architecture/behavior, boundaries and risks only when they earn it; a small PR stays small. When a diagram is expected but doesn't apply, say "Not applicable: …" in one line.
7. **Visual evidence** (user-visible UI): every affected state with a stable ID; detached temp worktree at the merge base; identical scenario/viewport/locale/theme/fixtures/readiness on both revisions; captures in a gitignored temp dir with identical names per revision; inspect and reject bad captures; keep a handoff record per state (id, title, runtime, viewport, before/after paths; `absent`/`removed`); upload as GitHub user assets; image row before label row; verify URLs; delete temp worktrees only after upload succeeds. A failed capture blocks; no upload path → stop before creating the UI PR and report local paths. Never commit PR-only images.
8. **Publish, then re-read** the live PR (title, base, head, body, diagrams, tables, images), then work review threads and checks: fix confirmed errors, push, reply with evidence, resolve.

### Host-neutral translation

- Upstream's install paths (`~/.claude/skills`, `~/.agents/skills`, `npx skills add`) and the `upload-github-attachment` skill are host-specific. On GitHub the sanctioned upload is `gh pr create|edit --body-file body.md --attach <file>` (gh ≥ 2.99.0; confirm `gh pr create --help` lists `--attach`, since the box's gh may be older). Otherwise use the host's sanctioned GitHub upload tool. No upload path → upstream's stop rule applies.
- "`gh` CLI or another GitHub workflow" → the host's GitHub tools (MCP or `gh`), whichever this run is allowed to use.

### nstack overrides (named)

- **Verification record, not just `## Verification`.** Upstream asks for commands and results. nstack's record (below) is a superset: pinned to the head SHA, oracle named, causation per behavior change (stash check), real-user-path rows by B-id, an explicit **Not run** list, and CI at head. Upstream's evidence-type separation is kept inside it.
- **Binding lines + conformance self-report.** `Design: <path>@<sha>` (or `Issue: #<n>`), `Closes #<n>`, and the conformance self-report are nstack additions the orchestrator's auto-review reads.
- **Publishing is gated.** Upstream creates the PR and replies to threads as part of the flow. In nstack, opening a PR, replying, and resolving threads are externally visible: do them only when the run allows. Fix rounds arrive through the orchestrator's bounce (see [implementer](sand-workflow:implementer)), not by self-triage of review threads.
- **Reviewer-brief mode is nstack-only.** Upstream says not to use the skill to review someone else's PR. Reviewer-brief mode doesn't review: it collates the auto-review, CI, and evidence for the human, and never re-judges the code.
- **Body shape: Outcome first, the rest folded.** Upstream leads with `## Summary` and puts `## Visual changes` near the bottom. nstack leads with a one-line result, then `## Outcome` (captured at the head SHA), `## Deviations from design`, `## Where to look`, and a binding line with the verification headline; the verification record, conformance, change map, diagrams, boundaries, and full visual pairs go in `<details>` (§5). Upstream's evidence content is kept, only moved.
- **Signed design assets are not PR-only images.** Captures that the designer ([nstack-design](sand-workflow:nstack-design)) committed in the design PR under `docs/design/assets/<feature>/` are part of the owner-merged design. Referencing or embedding them is allowed; don't flag, delete, or re-upload them.
- **Never merge.**

Repository rules win: read `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and the PR template first. Keep the template's required sections and add these where they help. Use the repo's own screenshot/upload/check scripts when it has them.

## Author mode

### 1. Pin the range

- Record repo, target branch, head branch, **merge base**, and the exact `base...head` the PR will publish.
- Stacked work: name the parent PR or branch, and never describe inherited changes as this PR's own.
- Separate runtime code from generated files, lockfiles, snapshots, migrations.

### 2. Understand the change

Read the full diff. Trace changed files to entry points, callers, state owners, persistence, and external boundaries. Classify: feature / fix / refactor / maintenance. Mark any business intent you can't prove from code as an assumption. List changed behavior scenarios with stable IDs (reuse the design's B-ids).

### 3. Run the checks (fresh, at the head you will push)

Follow the repo's required checks, then build the **Verification record**:

```markdown
## Verification record

Head: <full sha> Base: <branch @ sha> Pushed ref = HEAD: yes
Oracle: <issue AC / design B-scenarios / test files> — edited by this PR: no | yes (why)
Seams tested: <agreed seams> (+ any "chosen by implementer, not pre-agreed")

### Causation (per behavior change)

- <change> → `<test id>`: without fix FAIL `<salient line>` (`git stash -- <files> && <cmd>`); with fix PASS `<line>`
  (compile error / skipped / 0 tests selected ≠ FAIL)

### Checks run

| Command | Result | Salient line (N > 0) |
| ------- | ------ | -------------------- |

### Real user path

| Scenario (B-id) | Driver | Pass/Fail/Skip/Blocked | Evidence link | Reason if Skip/Blocked |
| --------------- | ------ | ---------------------- | ------------- | ---------------------- |

### Not run

- <check> — <why> (never silently omit)

### CI at head

<check>: success | failure | pending @ <sha>
```

Keep evidence types apart: focused tests prove covered behavior; typecheck/lint prove static checks; CI proves its configured checks; runtime checks prove only the inspected environment; manual acceptance proves only that scenario.

### 4. Visual evidence (user-visible UI changes only)

Follow upstream's visual workflow (loop step 7). nstack essentials:

1. Trace the diff to every affected page, dialog, route, responsive state, theme, locale. Give each state a stable ID.
2. Create a **detached temporary worktree at the merge base**. Never switch or overwrite the active worktree.
3. Capture the same scenario on merge base and head with identical viewport, locale, theme, fixtures, readiness condition, into a gitignored temp dir with identical names per revision. Use the repo's `verify-*` skill or screenshot tool when present.
4. Inspect every image. Reject blank, loading, error, or onboarding captures unless that state is the point. A failed capture is recorded with its reason, not dropped.
5. Upload images as GitHub user assets: write the body to `body.md` with relative references (`![Invoice list, two rows](./after.png)`), then `gh pr create|edit --body-file body.md --attach ./after.png …` (gh ≥ 2.99.0, write access, user OAuth token or PAT; GitHub App tokens and GHES are unsupported; ≤10 MB per image/GIF; ≤50 files per call). Inspect every image for secrets/PII first: attachments can't be deleted and are public on public repos. A non-zero exit can still have uploaded earlier files, so re-read the PR before deciding what happened. Fallbacks, in order: same-repo orphan assets branch or hidden ref embedded via `blob/<sha>/…?raw=true` (test private-repo rendering once), else stop.
   - **Never commit PR-only images** to the feature branch. **Exemption:** signed design assets under `docs/design/assets/<feature>/`, committed by the designer (nstack-design) in the design PR, are allowed and are not PR-only captures.
   - **Never host evidence elsewhere (PixelLeak):** no public gists, no repos, releases, or tags created to host images, no other owner's repo, no external image hosts (imgur, `gitshot`, …), no cookie/session-based uploaders, no undocumented upload endpoints.
   - **Origin** has no upload API: CLI evidence goes in a console block; for GUI-heavy work prefer a GitHub-mirrored repo, otherwise stop and report local paths.
   - If upload is impossible, stop before creating a UI PR and report the local paths. Remove temp worktrees only after upload succeeds.
6. Put the single most telling capture (or Before | After pair) inline under `## Outcome`. The full set goes in a `<details>` "Visual changes" fold: image row first, label row second; `Absent` / `Removed` for new or deleted states.

A screenshot proves layout and color; motion needs a recording.

### 5. Compose the body

Skim-first, fixed shape (template, per-block rules, and checks: [`references/pr-body.md`](references/pr-body.md)). Above the fold: ~≤40 rendered lines and ≤1,200 chars of prose, not counting the Outcome artifact. Size it to the change: a dependency bump, refactor, or docs PR is 1–2 sentences, no headers, under ~300 chars, and says "No behavior change: …" instead of an Outcome.

```markdown
**<what now works, or the symptom fixed>.** Implements design D<a>–D<b>. (stacked: parent #<n>)

## Outcome (captured at `<short sha>` = PR head)

<one console block with real `$ command` + output, or one attached image / clip ≤30 s;
a fix shows Before | After from the same scenario>

## Deviations from design

None. (or: A<n> <what> — seed, no amendment needed / amendment proposed: <link>)

## Where to look

1. `<file>` `<symbol>` — <why it's the riskiest part>
2. <one-way door / migration / concurrency edge> (1–3 pointers, never a file list)

Design: <path>@<sha> (or: Issue: #<n>) · Closes #<n> · Verification: <N> PASS, <M> Not run @ <short sha> (see fold)

<details><summary>Verification record @ <sha></summary>(§3)</details>
<details><summary>Conformance self-report</summary>Paths ⊆ layout: yes/no (<list>) · New public surface: <none | S-ids | proposed amendment A<n>> · Budget: files a/b, LOC c/d</details>
<details><summary>Change map</summary>| Module | Before | After | Description |   (several modules or ownership changes)</details>
<details><summary>Architecture and behavior</summary>Mermaid module flow / sequence / state diagram; fixes that change a flow: comparable Before and After, then the exact changed edge.</details>
<details><summary>Boundaries and risks</summary>| Invariant or boundary | Failure mode | Protection | Evidence or gap |</details>
<details><summary>Visual changes (all states)</summary>(§4)</details>
<details><summary>Rollout and follow-up</summary>migrations, flags, known gaps — say whether each blocks merge</details>
```

Rules:

- Lead line, Outcome, and the verification headline are always present; folds only when they earn it (upstream `references/pr-body.md` for diagram shapes and risk groups). The Outcome artifact is never inside `<details>`, and the Outcome is real output at the head SHA, never intended output.
- Module names, not raw file lists, in the change map. No file-by-file changelog, no process narration, no emoji, no empty or "N/A" sections. Diagrams label arrows with real calls/events and match code branches. Every listed behavior scenario is covered or named unverified. Never write "safe", "fixed", or "backward compatible" without evidence; mark gaps `Not verified`.
- **Freezy text checks B1–B8** (reference) run on this body: advisory for implementation PRs unless B-scenarios need visual evidence, blocking for design PRs. They FAIL when `## Outcome` has no console block and no embedded media, when the artifact is inside `<details>` (or link-only), when the top is over budget, or when an image is hosted off-repo (gist, other owner, external host). Run them on your draft first.

### 6. Publish and check

Opening a PR is externally visible: do it when the run allows it. On GitHub prefer `gh pr create|edit --body-file body.md --attach …` so the body and its media land together. Then reopen the PR and verify title, base, head, body, diagrams, tables, and images render, the Outcome sits inline (not folded), and B1–B8 pass on the live body. Read review threads, comments, and check status; fix confirmed errors with focused checks, push, update the verification record to the new head, reply with evidence, resolve the thread (all under the run's permissions).

## Reviewer-brief mode (assist the human reviewer)

Input: a PR with an auto-review verdict. Output: one comment (or a block the orchestrator posts) the human can act on in minutes. Don't re-judge the code; collate and point.

```markdown
## Reviewer brief @ <head sha>

Design: <path>@<sha> (merged by owner in #<n>) | Issue #<n>
Auto review: PASS @ <sha> by <reviewer model family> — link
CI at head: <all success | list>

### What changed (30 seconds)

<2–3 lines + change-map link>

### Where to look first

1. <file:line or diagram> — <why it's the riskiest part>
2. …

### Decisions only you can make

- [ ] Amendment A<n>: <what> — cost if wrong: <…> (approve by naming it in a PR comment)
- [ ] Unrequested behavior: <…> keep or drop?
- [ ] Unapplied review findings: <count> (list in PR body)

### Evidence checklist

- [ ] Verification record head == PR head
- [ ] Every B-scenario / AC has a Pass row or a Not-run reason
- [ ] Screenshots/videos match the claims
- [ ] PR body shape B1–B8 (Freezy): PASS @ head, or the failing items named
- [ ] Not run: <items the human may want to run>

### Merge

`gh pr merge <n> --match-head-commit <reviewed sha>` (a later push makes this fail on purpose)
```

If the head moved since the auto review, say so at the top and stop: the brief is stale.

## Handoff

When this seat passes work to the orchestrator (for review), the human, or a fresh agent, compact context per upstream [`handoff`](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md) (mattpocock/skills @ `b0618bc`): a short note a fresh agent can continue from that points at artifacts by URL/sha instead of restating them, names the skills the next agent should run, and redacts secrets and personal data. nstack's required artifacts are **attached as well, not replaced**: the PR URL and head SHA, `Design: path@sha` or the issue, the verification record, the auto-review report @ head (brief mode), and the visual-capture handoff records. nstack override: upstream saves the note in the OS temp dir; here it goes inline in the dispatch or report, never into the repo.

## Anti-jobs

- Not a reviewer of someone else's code quality; that's the orchestrator's [auto-reviewer](sand-workflow:auto-reviewer) review or the human.
- No padding: don't add a table or diagram only to fill the template.
- No evidence hosting outside the repo's own attachments or same-repo refs (no gists, new repos, releases, external hosts).
- No secrets, tokens, full user records, or webhook payloads in the body.
- Never merge.
