---
name: paseo-plugin-e2e
description: Build and run real end-to-end tests for Paseo plugins through an isolated daemon, public SDK or CLI, and the Paseo Web UI. Use for plugin RPC, lifecycle, session environment, trust and client workflows in this workspace.
---

# Paseo plugin E2E

Exercise the installed plugin as a caller or user does. This repository uses E2E tests for executable behavior; unit tests are not applicable. Bend proof and generated-artifact checks remain separate static verification.

Read the plugin manifest, package and installed SDK declarations before choosing APIs. CLI, client and plugin SDK versions must agree. The live documentation may describe APIs newer than this checkout.

## Test boundary

- Start a real daemon with a temporary `PASEO_HOME`, loopback port `0`, relay disabled and plugins enabled only in that temporary configuration. Install the unmodified plugin with the public plugin-management API or CLI. Paseo owns compilation; do not build a substitute host or evaluate bundles yourself.
- In 0.10.2, plugin management and RPC are exposed on `DaemonClient` through the version-specific exported `@getpaseo/client/internal/daemon-client` path used by the CLI. The root `createPaseoClient` API does not expose these operations. Recheck this export when upgrading. Connect and call `fetchAgents({ subscribe: {} })` before operations. Assert returned results and errors rather than private plugin state.
- For UI behavior, use Playwright against the daemon's bundled Web UI. Click accessible controls and assert rendered feedback. Do not stub React Native, mount components in a fake host, intercept RPC responses, or treat catalog delivery as proof of rendering.
- Use real external dependencies. For devenv, create a small declarative Nix project with pinned inputs, an isolated trust directory, and an observable marker. Verify preparation, reload and environment delivery to the actual provider process. Session creation alone needs no model turn.
- Missing prerequisites fail with a useful error. Do not turn tests into opt-in environment gates or silently skip them. Separate a genuinely platform-specific suite explicitly and document its prerequisites.

## Isolation and evidence

Keep daemon, project, trust and cache fixtures below a test-owned temporary root. Remove inherited `PASEO_*` routing and `PASEO_DEVENV_*` session markers from child environments. Preserve the tools and Nix configuration needed by real dependencies. Never write the user's daemon configuration, trust file or credentials.

Register teardown before startup. Close SDK connections and browsers, terminate the owned supervisor and its descendants, and remove temporary data even after failed assertions. Preserve daemon logs, browser screenshots and traces on failure without dumping environment secrets.

Poll observable states with deadlines; report the last result on timeout. Run sequentially when scenarios share a daemon or trust file. Cover meaningful success, rejection, failure and recovery paths rather than translating every removed unit assertion into an E2E case.

For the implemented harness, commands, version details and scenario choices, read [references/workspace.md](references/workspace.md). Extend existing fixtures when possible, then run the affected E2E flow and the repository's required `pnpm format` and `pnpm check`.

Research sources: [plugin reference](https://paseo.sh/docs/plugins/reference), [SDK reference](https://paseo.sh/docs/sdk/reference), [real daemon testing](https://github.com/getpaseo/paseo/blob/main/docs/ad-hoc-daemon-testing.md), and [testing guidance](https://github.com/getpaseo/paseo/blob/main/docs/testing.md). Reviewed 2026-10-02; the installed 0.10.2 declarations govern this workspace.
