---
name: paseo-plugin-dev
description: Create, extend, debug, or prepare releases of Paseo plugins, including client UI, daemon RPCs, and agent providers. Use for Paseo plugin projects and this pnpm monorepo.
---

# Paseo Plugin Development

Use the [official quickstart](https://paseo.sh/docs/plugins) as the starting point. These instructions adapt it to this repository; they do not authorize installing plugins into a daemon or publishing packages.

## Repository workflow

- Enter `devenv shell` for Node 24 and pnpm. From outside the shell, use `devenv shell -- <command>`.
- Install with `pnpm install --frozen-lockfile` for an unchanged checkout. Use `pnpm install` after changing dependencies or adding a plugin, and retain `pnpm-lock.yaml`.
- Create a plugin with `pnpm plugin:new <id>`. The helper invokes the pinned official CLI under `plugins/<id>`, adapts its examples to the repository's lint rules, formats them, and assigns the private package name `@paseo-plugins/<id>`.
- Run `pnpm --filter @paseo-plugins/<id> typecheck` while editing. Run `pnpm format` and `pnpm check` before handing off changes.
- Follow `eslint.config.mjs`: source comments are forbidden, promises need handling rather than `void`, switches must be exhaustive, and unsafe type assertions are rejected. Run `pnpm lint` for feedback.
- Keep each plugin independently installable. Another workspace package is not automatically available when Paseo installs a plugin subdirectory. Include any shared code and runtime dependencies in its distributable package.

## Version-aware implementation

Read the target plugin's manifest, package, entries, and installed SDK declarations before choosing APIs. Keep the CLI and SDK versions aligned when upgrading; update the manifest's supported Paseo range for newly required APIs.

This repository starts with Paseo 0.10.2. Its generated client entry uses `addSurface` and `addSidebarItem`. The live documentation currently shows `addScreen` and `addSidebarHeaderItem`. Use the installed SDK as the authority for this checkout, and check the current documentation when upgrading. Do not mix examples from different releases.

## Runtime boundaries

Each plugin needs `paseo-plugin.json` and at least one default-exported setup function in `index.client.tsx` or `index.server.ts`. Setup returns cleanup for owned resources.

Put UI code in `client/`, daemon work in `server/`, and neutral schemas or values in `shared/`. Avoid extra root code files. Shared code cannot import runtime-specific modules, even for types. Client bundles cannot import server code or Node modules; server bundles cannot import client code or React.

Use SDK `/client` for client contexts and hooks, `/server` for daemon contexts, and the SDK root for shared contracts. Preserve host-provided libraries as development dependencies. Verify unfamiliar contribution methods in the [reference](https://paseo.sh/docs/plugins/reference) and installed types.

## Client UI and RPC

Use React Native components and `onPress`; derive styles from `theme.colors` and `layout.compact`. Keep DOM out of TypeScript's `lib`. Isolate browser globals in `client/web.ts` with a platform check and native fallback.

Prefer the host's Paseo SDK for ordinary operations. For plugin-specific daemon work, define a Zod RPC contract in `shared/`, register it with `server.handle`, and invoke it through `useRpc`. Keep credentials on the server. Dispose subscriptions and timers during cleanup.

## Conditional guides

- For installation, reload, troubleshooting, or release preparation, read [references/development.md](references/development.md).
- For a coding-agent provider, read the [provider guide](https://paseo.sh/docs/plugins/providers) and the installed `/server/provider` types. Prefer the ACP adapter for an ACP agent; use direct provider registration for another protocol. Advertise implemented capabilities only, publish complete timeline snapshots with stable IDs, and close owned sessions and processes.
- For an old single-entry plugin, follow the [migration guide](https://paseo.sh/docs/plugins/migration) before adding features.
