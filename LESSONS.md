<!-- reviewed-through: 70e1fb5 (2026-10-18 13:35 +0800) -->

# Lessons

What recent merged work got wrong, and the rule that would have caught it. Rules seen on three separate days move to [docs/code-standards.md](docs/code-standards.md). Evidence is a commit, PR, or known-issue link.

## Test isolation

**Keep E2E fixtures inside the test's own scope: match processes by the test's paths and isolate every shared host location the suite touches.**

- Why: the only behavior suite ran beside a live daemon and deleted its handoff directory; an unscoped process match made the Obsidian suite flaky.
- Lens: check · Kind: judgement
- Evidence: `c23a100` (2026-10-15, PR #8) — `syncProcesses()` matched any `ob sync --continuous` process on the host; it now requires the test vault's path. `df72db2` (2026-10-15, PR #9) — E2E daemons shared `/dev/shm/paseo-<uid>-secret-request/`, and suite instances swept a live daemon's directory (`docs/known-issues/0002-secret-request-sweep-deletes-live-handoff-dir.md`).
- Seen 1× (10-15, two instances)

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

## Proposed checks

- **CI runs `pnpm check` on every PR.** No PR in the window had a check; PR #8 merged with "Verification: Not run in this change." Proposed 2026-10-18; owner decision.

## Moved to the standards (2026-10-18)

- **Test every lifecycle transition the feature exposes — daemon restart, plugin reload, caller timeout or cancel, and a second instance — before merging.** Seen 3× (10-03, 10-14, 10-15). → [docs/code-standards.md](docs/code-standards.md#lifecycle-and-state)
- **Paste the observed result of `pnpm check` (or the affected suite) into the PR before merging; an expected pass or a command list is not verification.** Seen 3× (10-13, 10-15, 10-18). → [docs/code-standards.md](docs/code-standards.md#verification)
