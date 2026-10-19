# Paseo plugins

Use [skills/paseo-plugin-dev/SKILL.md](skills/paseo-plugin-dev/SKILL.md) for plugin development. The same skill is discoverable through `.agents/skills/paseo-plugin-dev`.

- Use Node 24 and pnpm from `devenv shell`.
- Plugin packages live in `plugins/*`; create them with `pnpm plugin:new <id>`.
- Keep CLI and SDK versions aligned. The installed SDK defines the APIs available to this checkout.
- Preserve Paseo's client/server/shared runtime boundaries and React Native support.
- Run `pnpm format` and `pnpm check` for changes. Do not introduce a separate bundler for ordinary plugins; Paseo compiles their source.
- Unit tests are not applicable in this repository. All executable behavior tests must be real E2E tests; use [skills/paseo-plugin-e2e/SKILL.md](skills/paseo-plugin-e2e/SKILL.md), also discoverable through `.agents/skills/paseo-plugin-e2e`. Run `pnpm test:e2e` against isolated real daemons and real dependencies; do not mock plugin hosts, transport, providers or devenv. Preserve Bend proof and generated-artifact verification as static checks.
- Repository setup does not authorize changing daemon configuration or publishing packages.
- Preserve the supplied ESLint rules: strict type-aware checks, exhaustive switches, no unsafe assertions, no floating promises (including `void`), and no source comments.
- Before changing code, read [LESSONS.md](LESSONS.md): what recent merged work got wrong and the rule that would have caught it. Review changes against [docs/code-standards.md](docs/code-standards.md).

## paseo-omp-optimize

Root purpose: improve the OMP experience inside Paseo by closing OMP-specific fidelity gaps in Paseo's generic session and timeline model. An OMP session in Paseo must not be worse than running OMP directly.

- The purpose covers presentation fidelity (OMP output shown as OMP produced it) and capability fidelity (tools, context and interaction available to the OMP session). The current implementation covers presentation only: it restores images from finished OMP `Read` rows and projects per-tool-call OMP intents into the transcript.
- Admit only OMP-specific behavior that Paseo's generic integration drops, flattens, or makes costlier. General Paseo UI improvements, other providers, and defects OMP itself should fix do not belong in this plugin.
- Judge additions against observed OMP sessions, not a wishlist. Record the gap and its evidence before broadening the plugin.
