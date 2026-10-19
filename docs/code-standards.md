# Code standards

Judgement rules promoted from [LESSONS.md](../LESSONS.md) on 2026-10-18. Review changes against them; mechanical rules belong in checks, not here.

## Lifecycle and state

Test every lifecycle transition the feature exposes — daemon restart, plugin reload, caller timeout or cancel, and a second instance — before merging.

Why: state kept in memory or scoped to one process disappears, is deleted by a peer, or is handed to a caller that is already gone.

Evidence: `cd772ac` (2026-10-03), `72dad18` (2026-10-14), `df72db2` (2026-10-15, PR #9). `8314c27` (2026-10-19, PR #16) documents intent rows lost on daemon restart and ships only a live-turn E2E.

## Verification

Paste the observed result of `pnpm check` (or the affected suite) into the PR before merging; an expected pass or a command list is not verification.

Why: merges landed without an observed result — the only behavior suite was unrun in PR #5, #8, #11 and #13, and PR #16/#17 omitted their local passes from the description — and the repository has no CI job.

Evidence: `34c7c09` (2026-10-13, PR #5), `c23a100` (2026-10-15, PR #8), `4db1037` and `70e1fb5` (2026-10-18, PR #11/#13), `8314c27` and `01e7852` (2026-10-19, PR #16/#17: "Not run in this description" / "Not run in this change" after local passes).

Mechanical backing: a CI job that runs `pnpm check` on every PR is proposed; the owner decides.
