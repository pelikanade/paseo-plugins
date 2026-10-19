# Paseo plugins

A pnpm workspace for developing independently installable [Paseo plugins](https://paseo.sh/docs/plugins). The development shell uses Node 24. Nix inputs and Node dependencies are pinned in `devenv.lock` and `pnpm-lock.yaml`.

## Get started

Install [devenv](https://devenv.sh/getting-started/) and enter the shell:

```sh
devenv shell
pnpm install --frozen-lockfile
pnpm check
```

With direnv installed, `direnv allow` activates the same shell through `.envrc`. Commands can also run directly, for example `devenv shell -- pnpm check`.

## Layout

```text
plugins/
  hello-paseo/                  # Official starter: client surface + daemon RPC
  devenv/                       # Trust-gated environments + Bend2 policy
  generative-ui/                # Native Chat cards + scoped MCP + agent skill
  host-monitor/                 # Daemon host CPU, memory and load in the sidebar footer
  obsidian/                     # Read-only Obsidian vault: pull-only Sync + vault MCP tools
  paseo-omp-optimize/           # Renders images that OMP read in the chat timeline
scripts/
  create-plugin.mjs             # Wraps the pinned Paseo scaffold
skills/
  paseo-plugin-dev/             # Reusable development skill and workflow guide
  paseo-plugin-e2e/             # Real daemon, browser and devenv testing skill
.agents/skills/paseo-plugin-dev # Skill discovery link
devenv.nix                     # Node 24 + pnpm + Bend 2.0.32
pnpm-workspace.yaml            # Independent plugin packages
favicon.svg                    # Project icon Paseo detects for this repository
```

Each plugin keeps its own manifest, TypeScript configuration, dependencies, and `client/`, `server/`, and `shared/` directories. Keep distributable plugin code inside its package so installation from a subdirectory works independently of this workspace.

The root `favicon.svg` is the icon Paseo shows for this project. Paseo scans `public/`, `static/`, `assets/`, `images/`, and `img/` first, then the project root, for names such as `favicon.svg`, `favicon.png`, `icon.*`, `logo.*`, and `favicon.ico`; the first square file under 32 KB wins, so a future `public/` directory would take precedence. Setting a custom icon in the app overrides detection and is stored by Paseo, not in the repository.

## Paseo worktree lifecycle

The root `paseo.json` configures [Paseo worktree hooks](https://paseo.sh/docs/worktrees.md):

- **Setup:** `bash scripts/worktree-setup.sh` enters devenv and installs dependencies with `pnpm install --frozen-lockfile`.
- **Teardown:** `bash scripts/worktree-teardown.sh` removes the worktree's root and plugin `node_modules`, `.devenv`, and `.direnv`. It refuses to run in the primary checkout and skips symlinked plugin directories.
- **Refresh plugins:** the `refresh-plugins` toolbar action fast-forwards the primary checkout's `main` from `origin/main`, runs `pnpm install --frozen-lockfile` when dependency manifests changed, then reloads every enabled directory plugin installed from that checkout's `plugins/` directory. It refuses to update a checkout that is not on `main`, and skips disabled plugins.
- **Install plugins:** the `install-plugins` toolbar action fast-forwards the primary checkout's `main`, runs `pnpm install --frozen-lockfile`, lists repository plugins whose manifest ID is not installed, and installs the one selected by number. It refuses to update a checkout that is not on `main`.

The daemon machine needs Nix, devenv, jq, and the Paseo CLI available on its `PATH`. The hooks and both plugin scripts resolve the checkout themselves, so they can also be invoked from another directory. Teardown can be repeated; Paseo removes the worktree directory after it completes.

Commit `paseo.json` and these scripts to the base branch used for new worktrees. Paseo reads that committed version, so uncommitted lifecycle changes do not apply to newly created worktrees.

## Add and edit plugins

```sh
pnpm plugin:new my-plugin
pnpm install
pnpm --filter @paseo-plugins/my-plugin typecheck
pnpm format
pnpm check
```

IDs start with a lowercase letter and use lowercase letters, digits, or hyphens. The generator refuses a nonempty destination. New packages are private until you prepare a release.

The CLI, client, and plugin SDK are pinned to **0.11.2**, the release this workspace targets. The scaffold and `plugins/hello-paseo` register UI with `addScreen` and `addSidebarHeaderItem`; `addSurface`, `addSidebarItem`, and `openSurface` are deprecated aliases that `pnpm lint` rejects. Use the installed SDK declarations for this pinned release. Upgrade CLI, SDK, and manifest compatibility together.

## Try the starter in Paseo

Use an existing daemon on the development machine. Enable plugins in that daemon's Settings → Plugins, then run:

```sh
pnpm exec paseo plugin install "$PWD/plugins/hello-paseo"
pnpm exec paseo plugin ls
```

Open Greeting in the sidebar and select Create greeting to call the daemon RPC. After editing:

```sh
pnpm --filter @paseo-plugins/hello-paseo typecheck
pnpm exec paseo plugin reload hello-paseo
pnpm exec paseo plugin logs hello-paseo
```

Installation paths refer to the daemon's machine. Paseo compiles plugins on load; no separate plugin build is needed.

## E2E tests

Unit tests are not applicable here. All executable behavior tests run through a real isolated Paseo daemon and real dependencies. The workspace shell supplies Chromium; outside it, install Playwright's Chromium with `pnpm exec playwright install chromium`, or set `PASEO_E2E_BROWSER` to a compatible system Chromium executable.

```sh
pnpm test:e2e
```

The session scenarios require Linux `/proc`, Nix, devenv, Bash and a real OpenCode executable on `PATH`; the workspace's declarative `pkgs.opencode` supplies it inside `devenv shell`, the way `pkgs.chromium` supplies the browser. They create sessions without sending model turns and inspect selected marker variables in actual OpenCode server processes. Tests use temporary daemon, project, provider data/config/cache and trust directories, and disable the relay. They never install plugins into the user's daemon or alter the user's project trust. Cold Nix builds can take minutes. Missing prerequisites fail the suite.

The [generative-ui scenario](e2e/generative-ui.e2e.mjs) uses the real MCP transport and Web UI to publish cards, apply patches, edit form controls, submit to the same agent and reload the plugin. Submission starts an actual OpenCode turn; the assertion checks delivery of the user message and does not depend on a particular model response.

Failure diagnostics are saved under ignored `test-results/`, including daemon logs, browser logs, screenshots and Playwright traces. Inspect a trace with `pnpm exec playwright show-trace test-results/<run>/trace.zip`.

## Commands

| Command                       | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `pnpm plugin:new <id>`        | Scaffold an independent plugin package                          |
| `pnpm typecheck`              | Typecheck all plugin packages                                   |
| `pnpm lint`                   | Run strict, type-aware ESLint checks                            |
| `pnpm lint:fix`               | Apply ESLint's automatic fixes                                  |
| `pnpm test` / `pnpm test:e2e` | Run real plugin E2E scenarios                                   |
| `pnpm test:obsidian`          | Run the credential-gated real Obsidian Sync suite               |
| `pnpm verify`                 | Check Bend2 proofs and committed model artifacts                |
| `pnpm format`                 | Format source, configuration, and Markdown                      |
| `pnpm check`                  | Run typechecking, linting, proofs, tests, and formatting checks |
| `pnpm exec paseo <args>`      | Use the pinned Paseo CLI                                        |
| `devenv test`                 | Verify Node 24, frozen dependency installation, and checks      |

## Development skill and distribution

The [devenv plugin](plugins/devenv/README.md) adds session environment preparation, trust controls, MCP and native status/settings. Its [verification guide](plugins/devenv/verify/README.md) describes 54 Bend2 laws and generated-artifact checks. Bend is required for repository checks; installed plugins use the committed JavaScript model. The [E2E skill](skills/paseo-plugin-e2e/SKILL.md) explains the real daemon and browser workflow and is discoverable through `.agents/skills/paseo-plugin-e2e`.

The [generative-ui plugin](plugins/generative-ui/README.md) adds native json-render cards and forms to Chat. Its bundled [agent skill](plugins/generative-ui/skills/generative-ui/SKILL.md) describes the component catalog, streamed inline protocol and submission workflow. New agents receive scoped MCP tools; existing conversations can use `/ui`.

The [filler-noise plugin](plugins/filler-noise/README.md) hides assistant rows whose text is only dots, ellipses, or whitespace, such as the `.` DeepSeek models emit on tool-call turns.

The [paseo-omp-optimize plugin](plugins/paseo-omp-optimize/README.md) replaces a finished OMP image read row with the image itself. A timeline transformer recognizes `Read image file [image/...]`, and a daemon RPC reads the original file relative to the agent's working directory. PNG, JPEG, GIF, WebP, AVIF and BMP up to 10 MiB are supported; failures fall back to OMP's original text.

The [host-monitor plugin](plugins/host-monitor/README.md) puts the daemon host's CPU, memory and load average in the sidebar footer. It samples once per second, keeps 60 samples in memory, and refreshes the client every two seconds. Selecting the footer row opens a popover with memory details, 1/5/15 minute load averages, uptime and 60 second sparklines.

The [obsidian plugin](plugins/obsidian/README.md) keeps one Obsidian vault in pull-only sync through the official headless CLI and gives every agent four read-only vault tools, a prompt block from `.paseo/system.md` and `.paseo/skills/*.md`, and an attachment picker. Its default E2E suite provisions `obsidian-headless` when `ob` is not on `PATH`; the real Sync suite needs an account and is kept out of `pnpm test:e2e`:

```sh
OBSIDIAN_AUTH_TOKEN=... OBSIDIAN_E2E_VAULT="<throwaway vault id or name>" pnpm test:obsidian
```

Without those variables that suite fails with a prerequisite error instead of skipping.

The [ESLint configuration](eslint.config.mjs) follows [AsterisMono/obsidian-agent](https://github.com/AsterisMono/obsidian-agent/blob/main/eslint.config.mjs), with generated environment directories ignored. It enables strict type-aware checks, exhaustive switches, rejects unsafe assertions and unhandled promises (including `void`), and forbids source comments.

Use `$paseo-plugin-dev` in an agent that discovers `.agents/skills`, or load [SKILL.md](skills/paseo-plugin-dev/SKILL.md) directly. Its [workflow reference](skills/paseo-plugin-dev/references/development.md) covers local reloads and release preparation.

For distribution, start with the [Paseo publishing guide](https://paseo.sh/docs/plugins/publishing). The devenv, generative-ui, and filler-noise packages release on npm as `@pelikanade/paseo-plugin-<id>` at 0.1.0 under MIT; hello-paseo stays private as the starter, obsidian stays private while the read-write slice is deferred, and paseo-omp-optimize stays private. Publish one with:

```sh
pnpm --filter @pelikanade/paseo-plugin-devenv exec npm publish --access public
```

Inspect package contents with:

```sh
pnpm --filter @paseo-plugins/hello-paseo exec npm pack --dry-run
```

Publish source entries and their runtime directories. Host-provided libraries remain development dependencies. Plugins with extra runtime dependencies need a standalone installation strategy when distributed through Git; the workspace lockfile alone does not provide one.
