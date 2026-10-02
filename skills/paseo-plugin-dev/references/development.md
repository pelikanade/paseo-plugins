# Development and release workflow

Sources: [quickstart](https://paseo.sh/docs/plugins), [reference](https://paseo.sh/docs/plugins/reference), and [publishing](https://paseo.sh/docs/plugins/publishing). Reviewed on 2026-10-02. Fetch current guidance when changing Paseo versions or release behavior.

## Local daemon workflow

Run from the repository root inside the devenv shell, replacing `<id>`:

```sh
pnpm --filter @paseo-plugins/<id> typecheck
pnpm exec paseo plugin install "$PWD/plugins/<id>"
pnpm exec paseo plugin ls
pnpm exec paseo plugin reload <id>
pnpm exec paseo plugin logs <id> --json
```

Install only when the task authorizes running the plugin on the target daemon. Plugin code is unsandboxed. Check the daemon's current `pluginsEnabled` value and obtain explicit user authorization before changing it to true, as required by the quickstart. Repository setup alone does not authorize enabling plugins.

Edits require a reload. Typechecking does not exercise the daemon compiler's runtime-boundary checks or native rendering. When a daemon is available and installation is authorized, verify the status is `running`, exercise the affected surface or RPC, and check errors. If a surface is missing, inspect the selected host, plugin state, and backend logs. Check phone layouts for UI changes.

## Packaging

```sh
pnpm check
pnpm --filter @paseo-plugins/<id> exec npm pack --dry-run
```

Inspect the package contents: manifest, runtime entries, runtime directories, and needed assets. TypeScript source is compiled by Paseo. Host libraries stay in `devDependencies`; additional runtime libraries belong in `dependencies`.

Keep `private: true` until an npm release is requested. Choose the real package scope and version before publishing. The package name identifies acquisition; the manifest ID identifies the installation.

For Git distribution, select the plugin subdirectory, for example `owner/repository:plugins/<id>`. A plugin using host modules only needs no preparation command. Runtime dependencies require a reproducible installation strategy on the daemon host: the publishing guide describes a plugin-local npm lockfile and `build: [["npm", "ci", "--omit=dev"]]`. A root pnpm workspace lockfile is not a standalone npm lockfile. Evaluate the actual deployment environment before choosing pnpm-specific preparation.

Paseo skips npm lifecycle scripts during acquisition. Native setup or generated files may need explicit preparation or inclusion in the package. Verify those files and commands on the intended host before release.
