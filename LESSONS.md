<!-- reviewed-through: 8314c27 (2026-10-19 17:15 +0800) -->

# Lessons

What recent merged work got wrong, and the rule that would have caught it. Rules seen on three separate days move to [docs/code-standards.md](docs/code-standards.md). Evidence is a commit, PR, or known-issue link.

## Test isolation

**Keep E2E fixtures inside the test's own scope: match processes by the test's paths and isolate every shared host location the suite touches.**

- Why: the only behavior suite ran beside a live daemon and deleted its handoff directory; an unscoped process match made the Obsidian suite flaky.
- Lens: check · Kind: judgement
- Evidence: `c23a100` (2026-10-15, PR #8) — `syncProcesses()` matched any `ob sync --continuous` process on the host; it now requires the test vault's path. `df72db2` (2026-10-15, PR #9) — E2E daemons shared `/dev/shm/paseo-<uid>-secret-request/`, and suite instances swept a live daemon's directory (`docs/known-issues/0002-secret-request-sweep-deletes-live-handoff-dir.md`).
- Seen 1× (10-15, two instances)
- Done right on 10-18: `3f7593f` (PR #15) — the Obsidian E2E isolates `HOME` and asserts a pre-existing user skill (`beta`) is left untouched.

## Client error paths and fixtures

**Exercise the host's error and conflict paths and the real formats the feature parses before merging; a happy-path fixture does not prove error copy or parsing.**

- Why: the client silently dropped the host's conflict reason and showed sync-phase copy for pre-sync failures; skill discovery missed nested `SKILL.md` and read `>-` as a literal description.
- Lens: standards · Kind: judgement
- Evidence: `c23a100` (2026-10-15, PR #8) — `SettingsState.save` returns a boolean, so a stale-revision conflict lost the host's message; `tokenSet` failures that were not rejections showed the error body. Both fixed the day after PR #7. `edad5ad` (2026-10-18, PR #12) — fixtures had only flat `Skills/*.md` with plain scalars; nested skills and folded YAML descriptions were invisible, and non-skill files were listed as `not_injected`.
- Done right on 10-18: `edad5ad` — the compatibility note names the removed `not_injected` state, and the fixture now seeds a nested `SKILL.md` with a folded description.
- Seen 2× (10-15, 10-18)

## Documentation

**Update a known-issue status to fixed, with the commit, when the fix lands; the status line is current truth.**

- Why: the next reader re-solves a solved problem or exports an environment variable the project already sets.
- Lens: standards · Kind: judgement
- Evidence: `docs/known-issues/0001-e2e-browser-needs-fontconfig.md` (added in `e6e3916`, 2026-10-14) says "Fix is an environment variable, outside this repository's code"; `devenv.nix` has set `FONTCONFIG_FILE` since `34c7c09` (2026-10-13), and a ready session has it set.
- Seen 1× (10-14)

## Verification environment

**Run the affected E2E against the host build that implements the contract under test; a pass on the pinned older SDK proves only its fallback path.**

- Why: PR #16's E2E resolved `@getpaseo/cli` 0.11.2, which strips `sequence: "tool"`; it passed 5/5, yet the user's 0.12.0 fork still showed a slightly larger intent-row gap, so the test could not see the behavior the merge relied on.
- Lens: check · Kind: judgement
- Evidence: `8314c27` (2026-10-19, PR #16) — `e2e/support/runtime.mjs` resolves the CLI from the workspace pin (0.11.2), while `plugins/paseo-omp-optimize/README.md` says older hosts strip the field; session `01a15374-87eb-71d5-bcde-9df497fda320` (2026-10-19 09:18Z, `~/.omp/agent/sessions/-.paseo-worktrees-3hx8ogr2-cheerful-termite/2026-10-19T09-18-28-331Z_01a15374-87eb-71d5-bcde-9df497fda320.jsonl`) — the user reports the row's spacing is still slightly larger on `github:pelikanade/paseo`, three minutes after merge.
- Seen 1× (10-19)

## Host UI integration

**Read the host's layout source before styling a plugin contribution to a native surface.**

- Why: Paseo gives unflagged plugin rows a 16px stream gap while tool, thought and todo rows share a 32px rhythm; guessing produced three spacing revisions, and plugin-side negative margins then broke consecutive rows and the turn-footer gap.
- Lens: standards · Kind: judgement
- Evidence: session `e2fd98a1-eb59-4927-9854-433ca3e8e2fb` (2026-10-19), transcript `~/.omp/agent/sessions/-.paseo-worktrees-3hx8ogr2-blissful-crocodile/2026-10-19T02-19-22-205Z_01a151f4-d4dd-70e7-bb61-46eb3a371171.jsonl` — three user reports after the first intent row shipped. Paseo `packages/app/src/agent-stream/spacing.ts` (`getGapBetweenStreamItems`: tool sequence 0, otherwise `SPACING[4]`) and `packages/app/src/agent-stream/view.tsx` (`StreamItemWrapper` applies the gap) define the contract.
- Done right on 10-19: the host added `sequence: "tool"` on plugin timeline items; `plugins/paseo-omp-optimize/server/intent.ts` sets it on appended rows and `client/intent.tsx` leaves host spacing alone, so the row no longer patches gaps with negative margins.
- Seen 1× (10-19)

## Proposed checks

- **CI runs `pnpm check` on every PR.** The repository has no CI job. PR #16 and PR #17 merged on 10-19 with "Not run" in their descriptions after the verification standard landed in PR #14, although both had local passes (PR #16's E2E 5/5; PR #17's `pnpm check` 64/64) that the record omitted. Evidence: `8314c27` (#16), `01e7852` (#17). Proposed 2026-10-18; owner decision.
- **Run the OMP E2E against the 0.12.0 fork that implements `sequence: "tool"`, not the pinned 0.11.2 CLI.** The flag is stripped by 0.11.2, so the passing E2E exercised only the fallback row and the user's post-merge report found the remaining gap. Evidence: `8314c27` (#16), session `01a15374-87eb-71d5-bcde-9df497fda320`. Proposed 2026-10-19; owner decision.

## Moved to the standards (2026-10-18)

- **Test every lifecycle transition the feature exposes — daemon restart, plugin reload, caller timeout or cancel, and a second instance — before merging.** Seen 3× (10-03, 10-14, 10-15). → [docs/code-standards.md](docs/code-standards.md#lifecycle-and-state)
- **Paste the observed result of `pnpm check` (or the affected suite) into the PR before merging; an expected pass or a command list is not verification.** Seen 3× (10-13, 10-15, 10-18). → [docs/code-standards.md](docs/code-standards.md#verification)
