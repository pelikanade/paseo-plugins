# paseo-nstack

A Paseo workspace watcher that turns GitHub Project and repository changes into fresh nstack orchestrator agents.

Each workspace panel owns one binding to a GitHub repository, GitHub Project, and Ready status value. The plugin observes GitHub, prevents exact duplicate starts, and creates a write-enabled agent in that workspace. Nstack policy remains in the vendored skills; this plugin does not reproduce worker limits, review rules, or merge policy.

## GitHub

Authentication comes from `gh auth token --hostname <host>` on the machine running Paseo. Every GitHub API request reads the current token; neither the token nor the authenticated login is cached. Tokens are never written to plugin state.

Project discovery and watching require `read:project`. For the full nstack workflow, which updates Project statuses, authorize the broader `project` scope:

```console
gh auth refresh --hostname github.com --scopes project
```

Complete GitHub authorization on the daemon host, then use **Check again** in **Automatic agents**. Credential changes in GitHub CLI take effect on the next request without reloading the plugin. If `GH_TOKEN` or `GITHUB_TOKEN` supplies the credential, update that environment value and restart the daemon so its processes inherit the change.

Missing Project scope, invalid authentication, and other access denials appear as a single actionable notice. Settings show it beside the Project fields; background failures show it in the main panel. Checks continue on their normal schedule. **Check again** retries the failed discovery or connection test, or checks the saved workspace binding.

Optional server environment variables:

- `PASEO_NSTACK_GITHUB_HOST` defaults to `github.com`.
- `PASEO_NSTACK_GITHUB_REST_URL` defaults to `https://api.github.com`.
- `PASEO_NSTACK_GITHUB_GRAPHQL_URL` defaults to `https://api.github.com/graphql`.

## Vendored skills

The complete nstack skill tree lives under `skills/nstack/`. Regenerate and verify its runtime bundle with:

```console
pnpm --filter @paseo-plugins/paseo-nstack build:skills
pnpm --filter @paseo-plugins/paseo-nstack verify
```

## Reliability

Corrupt state is moved aside as `state.json.corrupt-*` and reported in the panel. Transient state and initialization failures retry without restarting Paseo.

Each launch uses a stable agent ID and is reconciled against existing agents before creation. Configuration failures remain blocked until the provider or model changes. Transient failures retry at most five times with exponential backoff from 30 seconds to 15 minutes.

GitHub Project and field discovery follows every GraphQL page. Closed pull requests are paged back to the last successful check. Per-workspace state is capped at 5,000 paused signals, 50,000 launch records, and 50,000 cursors; reaching a cap reports an error without advancing cursors or dropping the existing exact-duplicate history.

## Verification

Run the repository checks from the root:

```console
pnpm format
pnpm check
pnpm test:e2e
```
