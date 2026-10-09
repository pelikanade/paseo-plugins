---
name: lessons-ledger
description: >-
  Use for a daily (nightly) review of a repo's or a bot's recent work: what had
  to be fixed again, what shouldn't have shipped, what was verified too thinly.
  Appends rules with evidence to a lessons ledger, and promotes a rule seen on 3
  separate days into the standing standards, using Matt Pocock's retro lenses to
  pick where each fix belongs (check, standards, pointer, tooling).
---

# Lessons ledger

Turn recurring agent mistakes into durable rules without a human writing them. Each review adds rules with evidence to a ledger, and a rule only becomes a standard once it has shown up on **3 separate days**, so one-off noise never becomes law.

Source pattern: yetone's `LESSONS.md` in [yetone/magpie](https://github.com/yetone/magpie/blob/main/LESSONS.md), where code is "written, reviewed, merged and released by agents". After the release-batching lesson there, tags per day went from 170 to 16. Stack map: vault `Skills/nstack/STACK.md`.

## Upstream (follow this; this skill only adds the nstack wrapper)

The _diagnosis_ of each miss follows Matt Pocock's `retro`. Read it (and the `writing-for-agents` guide it points to) before a run and follow its lenses. Where this skill and upstream disagree on _how to diagnose a miss and where its fix belongs_, upstream wins. This skill keeps what is nstack's: the ledger, the watermark, evidence on every lesson, the 3-separate-days promotion rule, the quiet reporting, and the stack inputs. Each override is named below.

- [`retro`](https://github.com/mattpocock/skills/blob/main/skills/engineering/retro/SKILL.md): a session retrospective that proposes changes to the agent's _environment_, not its code.
- [`writing-for-agents`](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md): the style guide retro uses when the fix is a line in a skill, `AGENTS.md`, or standards file.

Pinned reading: mattpocock/skills `main` @ `b0618bc` (2026-10-08). If upstream has moved, re-read it; don't trust this summary.

### The upstream loop, in brief

1. Load the writing-for-agents guide (pointer wording, positive phrasing, no-ops, pruning).
2. Read the **primary sources** for the session (logs, transcripts), not summaries.
3. Look for improvement candidates through seven lenses:
   - **Navigation**: the agent was slow to find something → a navigation pointer.
   - **Automated checks**: a check could have caught the mistake. Read the repo's existing lint/check scripts and CI first; an unwired or broken check is the finding. A repo with no guardrail (no pre-commit, no CI running lint/typecheck/test) is itself a finding.
   - **Coding standards**: the reviewer missed something. A **mechanical** violation gets a deterministic check (custom lint rule, hook, CI job), full stop. Only genuine **judgement calls** go in the standards file.
   - **Global AGENTS.md**: steering that belongs in standards or checks instead.
   - **Tool economy**: expensive or token-hungry tool calls.
   - **No-ops**: steering lines that don't change behaviour.
   - **Information access**: the agent lacked something it needed (logs, read-only service access).
4. Present candidates by severity.

Its reference model: the implementer carries the most context pressure, the reviewer the least, so **the reviewer enforces standards**. `AGENTS.md`/`CLAUDE.md` are always loaded, so they hold navigation pointers only. The standards file is read at review time.

### Host-neutral translation

- "Call the Skill tool with `writing-for-agents`" → read that guide's file. "Search session logs on this machine" → read the transcripts, PRs, gate ledger lines, and verdicts for the window from wherever this host keeps them.
- `CLAUDE.md` in upstream = whatever always-loaded steering file the repo's agents read (`AGENTS.md`, `CLAUDE.md`, a bot persona). `disable-model-invocation` (human-only upstream) maps to: a daily routine is the invocation.

### nstack overrides (named)

- **Ledger + 3-day promotion instead of a one-shot list.** Upstream proposes changes immediately. nstack records each candidate as a lesson with evidence and promotes only after 3 separate days. Exception: a mechanical miss that is already backed by a cheap deterministic check may be proposed on first sighting, still as a proposal.
- **Stay quiet.** Upstream presents every candidate. nstack reports only promotions and serious misses.
- **Window = since the watermark.** Upstream defaults to the current session; nstack reviews everything since `reviewed-through`.
- **Standards file name.** Use the repo's existing `CODING_STANDARDS.md` or `CONTRIBUTING.md` when present (upstream code-review reads them first); else `docs/code-standards.md`, else `AGENTS.md`.
- **Implementers still read LESSONS.md.** Upstream would leave standards to review only. nstack keeps one navigation-pointer line in `AGENTS.md` so implementers read the ledger before work, but the enforcement point for promoted judgement rules is the auto-reviewer's Standards axis.

## Two files

- **Ledger**: the review's output. For a repo this is `LESSONS.md` at the root, or a vault note such as `Projects/<name> Lessons.md` when the owner doesn't want it in the repo. For a bot it's a vault note about that bot's own work.
- **Standards**: where promoted rules live. For a repo this is the standards file above. For a bot it's its persona or the SKILL.md it runs.

The ledger's first line is a watermark:

```markdown
<!-- reviewed-through: <short sha or ISO time> (<date time tz>) -->
```

## Run (once a day)

1. **Scope.** Read the watermark. Collect everything since then: commits on the default branch (merged PRs included), releases, reopened or follow-up issues, and for bots the transcripts or outputs from the window. Read primary sources, not summaries. If nothing is new, stop quietly.
2. **Find the misses.** For each item, ask three things:
   - Did it have to be **fixed again**? Look for a follow-up commit, revert, hotfix, or reopened issue that touches the same behavior within a day or two.
   - **Shouldn't it have shipped?** Look for a red check at merge, a failing new test, an untested release, or a skipped review.
   - Was it **verified too thinly**? For example, a claim with no command output, "works" never tried with the real thing, or one platform checked when it shipped on several.
     Then diagnose each miss through the retro lenses (navigation, automated checks, coding standards, AGENTS.md, tool economy, no-ops, information access) and tag the lesson with its lens. Also note the things **done right**. Positive examples teach too.
3. **Write or bump lessons.** Each lesson is shaped like this:

   ```markdown
   **<Rule as one imperative sentence, stated positively.>**

   - Why: <the failure it prevents, one line>
   - Lens: <navigation | check | standards | agents-md | tool-economy | no-op | info-access> · Kind: mechanical | judgement
   - Evidence: <sha / PR / issue / transcript link> — <what happened>
   - Done right on <MM-DD>: <sha/link> — <example>
   - Seen N× (<date>, <date>, …)
   ```

   If a new miss matches an existing rule, add its evidence and today's date, and bump `Seen`. Count separate **days**, not separate commits. Group lessons under short headings (e.g. Reading the report, Verification, User data, Concurrency/tests, Releases, Merging). Write rules about the class of mistake, not the single sample. Phrase the target behaviour, not a ban (writing-for-agents); pair any unavoidable prohibition with the positive target.

4. **Promote.** For any lesson whose `Seen` now covers ≥3 separate days, put it where its lens says it belongs (targets below). Text rules are rewritten as present-tense current truth (see [current-truth](sand-workflow:current-truth)) into the standards file; move the ledger entry under a `## Moved to the standards (<date>)` heading as a one-line pointer. Don't leave "was X" residue in the standards.
5. **Advance the watermark** to the last item reviewed, then save. In a repo, make one commit titled like `docs: LESSONS.md gets the review of <date>'s commits` and say in the body what was promoted. In the vault, edit the note in place.
6. **Report** only when something was promoted, or when a miss looks serious (data loss, credentials, a release that broke users). Otherwise stay quiet.

## Wiring

- Make sure the agents doing the work actually read the ledger. In a repo, `AGENTS.md` gets one navigation-pointer line: "Before changing code, read LESSONS.md: what recent merged work got wrong and the rule that would have caught it." A `CLAUDE.md` can just be `@AGENTS.md` plus `@LESSONS.md`.
- Run it from a daily routine. A Project PM can fold it into its morning [project-doc-maintenance](sand-workflow:project-doc-maintenance) pass, using the PM's own vault ledger note unless the owner wants a `LESSONS.md` in the repo.
- Where you can, back a promoted rule with a test or lint that fails when it's broken, so the rule enforces itself.

## Rules for the reviewer

- Evidence or it didn't happen: every lesson cites a sha, PR, issue, or transcript.
- Don't edit code during the review. The ledger records and promotes; fixes go through the normal lane.
- Don't reverse the owner's deliberate decisions. If a lesson would contradict one, write it as an open question for the owner instead of a rule.
- Keep the ledger short. Merge near-duplicates, and prune lessons that haven't recurred in about 30 days and were never promoted. When the always-loaded files (`AGENTS.md`, personas) grow, look for no-ops and steering that should move to checks or standards.

## In an agent coding stack

When the repo runs the nstack pipeline ([nstack-design](sand-workflow:nstack-design) intake, [nstack-orchestrate](sand-workflow:nstack-orchestrate) drain), add these to step 1 (Scope):

- **Gate history:** the orchestrator's ledger lines and auto-review verdicts since the watermark. A finding that needed a fix round is a "had to be fixed again" miss even though it never reached main. Count escalations after the bounce cap as serious. A Standards-axis finding the reviewer _missed_ (caught later) is a coding-standards lens lesson.
- **Not-run sections:** "Not run" rows in merged PRs' verification records. The same check skipped on 3 separate days is a lesson ("verified too thinly"), usually pointing at missing CI or a missing `verify-*` skill (automated-checks lens).
- **Design drift:** FAIL: design drift verdicts and approved Amendments. Repeated same-shape drift is a design-process lesson (target: nstack-design), and a scrap is always worth an entry.
- **Model routing:** rounds-to-PASS by model tier. A tier that keeps needing round 3 for a kind of issue is a routing lesson for nstack-orchestrate.
- **Tool economy / info access:** drains parked on budget, or workers that reported NEEDS_CONTEXT for something a pointer or read-only access would have given them.

Promotion targets in the stack, in order of preference (mechanical lessons always take the first):

1. A mechanical check: layout-rule config, a CI job, a lint, a pre-commit hook, a test (record "Enforced in: <file>").
2. The repo's standards file, which the auto-reviewer's Standards axis enforces and implementers read before work (judgement calls only).
3. A navigation pointer in `AGENTS.md` (navigation lessons only; keep it one line).
4. A stack skill's own text (e.g. a new line in the implementer dispatch prompt or the auto-reviewer checklist), proposed to the owner rather than edited silently.

## Handoff

When this seat passes work to the owner, the orchestrator, or a fresh agent (for example a promoted rule that needs a check built), compact context per upstream [`handoff`](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md) (mattpocock/skills @ `b0618bc`): a short note a fresh agent can continue from that points at artifacts by path/sha instead of restating them, names the skills the next agent should run, and redacts secrets and personal data. nstack's required artifacts are **attached as well, not replaced**: the ledger path and watermark, each promoted lesson with its evidence links, and the gate ledger lines / review reports it drew on. nstack override: upstream saves the note in the OS temp dir; here it goes inline in the dispatch or report, never into the repo.
