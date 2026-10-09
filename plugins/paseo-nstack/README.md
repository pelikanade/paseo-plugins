# paseo-nstack

A Paseo workspace watcher that turns GitHub issue workflow labels and repository changes into fresh nstack orchestrator agents.

Each workspace panel owns one binding to a GitHub repository owner/name. Settings contain automatic-start pause, check and repair intervals, and agent provider/model configuration. The plugin reads GitHub, prevents exact duplicate starts, and creates a write-enabled agent in that workspace. Nstack policy remains in the vendored skills; this plugin does not reproduce worker limits, review rules, or merge policy.

## GitHub

Authentication comes from `gh auth token --hostname <host>` on the machine running Paseo. Every GitHub API request reads the current token; neither the token nor the authenticated login is cached. Tokens are never written to plugin state.

The watcher needs read access to the repository's issues, label events, pull requests, checks, and comments. Designer and orchestrator agents need repository issue/label write access to create missing workflow labels and change issue states under the run's existing permissions. The plugin watcher never writes GitHub state.

Complete GitHub authorization on the daemon host, then use **Check again** in **Automatic agents**. Credential changes in GitHub CLI take effect on the next request without reloading the plugin. If `GH_TOKEN` or `GITHUB_TOKEN` supplies the credential, update that environment value and restart the daemon so its processes inherit the change.

Invalid authentication and repository access denials appear as a single actionable notice in settings or the main panel. Checks continue on their normal schedule. **Check again** retries the connection test or checks the saved workspace binding.

Optional server environment variables:

- `PASEO_NSTACK_GITHUB_HOST` defaults to `github.com`.
- `PASEO_NSTACK_GITHUB_REST_URL` defaults to `https://api.github.com`.

## Issue workflow

GitHub issue labels are canonical and mutually exclusive: `stack:backlog`, `stack:ready`, `stack:in-progress`, `stack:in-review`, `stack:merge-queue`, `stack:hitl`, and `stack:done`. Designer and orchestrator agents create missing labels and replace the previous workflow label while preserving unrelated category labels. State meanings and transitions live in [nstack-orchestrate](skills/nstack/nstack-orchestrate/SKILL.md#issue-workflow).

An open issue with `stack:ready` automatically signals the orchestrator, including on initial synchronization. Later Ready occurrences are detected from label events; unrelated title, body, comment, or category-label edits do not produce another Ready start. An issue with conflicting workflow labels requires human attention and cannot dispatch. Closed issues are excluded from active counts and Ready starts; agents apply `stack:done` in the merge/close loop.

Enabling a binding is standing permission to start orchestrator agents. Workspace and global pause retain observations and duplicate protection. Agents re-read issue state before dispatch and still enforce design approval, AFK/checkpoint eligibility, caps, review rules, and human-only merge. Human feedback and commands remain restricted to the authenticated human.

## Vendored skills

The complete nstack skill tree lives under `skills/nstack/`. Regenerate and verify its runtime bundle with:

```console
pnpm --filter @paseo-plugins/paseo-nstack build:skills
pnpm --filter @paseo-plugins/paseo-nstack verify
```

## Reliability

Corrupt state is moved aside as `state.json.corrupt-*` and reported in the panel. Transient state and initialization failures retry without restarting Paseo.

Each launch uses a stable agent ID and is reconciled against existing agents before creation. Configuration failures remain blocked until the provider or model changes. Transient failures retry at most five times with exponential backoff from 30 seconds to 15 minutes.

Recovery checks for an existing start notice before appending it again. Paseo 0.10.2 can lose plugin timeline notices when an agent is archived and reloaded.

Issue and label-event reads follow all required REST pages. Closed pull requests are paged back to the last successful check. Per-workspace state is capped at 5,000 paused signals, 50,000 launch records, and 50,000 cursors; reaching a cap reports an error without advancing cursors or dropping the existing exact-duplicate history.

## Verification

Run the repository checks from the root:

```console
pnpm format
pnpm check
pnpm test:e2e
```
