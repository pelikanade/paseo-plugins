# Bend2 policy verification

The runtime statically imports `server/model.generated.mjs` through `server/policy.ts`. Zod validates the artifact's callables and every returned tagged value. TypeScript handles files, clocks, processes, caching, and session bookkeeping; the compiled model decides build eligibility, injection eligibility, published status, application transitions, and reload requirements.

## Claims and ownership

`LAWS.bend` retains the reference implementation's 36 root laws byte for byte and adds 18 session and build laws. Every claim has exactly one `def Laws.<name>` in `PROOF.bend`. Claims must not be removed, weakened, or reordered to make a proof pass; fix the model or proof instead. The gate pins the inherited claim block by SHA-256 and checks coverage and duplicates for the entire set.

Root laws cover trust, the five preparation states, published status strings, legal transitions and injection decisions. Added laws cover waiting-budget exhaustion, application only through an opening with `Give`, preservation on background completion/change/revocation, reload requirements for prepared host sessions and stale or revoked applied sessions, and absence of builds during trust reads, status queries, or repeated in-flight requests.

The session model records what was returned at an interactive opening. Background completion cannot change that record. Revocation prevents subsequent injection while preserving the record of a previous application. `fresh` is supplied by the runtime from the canonical root, configuration signature, settings revision and build generation; it is an external observation, not a filesystem theorem.

## Toolchain and gate

The shell pins `github:bendlang/bend/b2111cf43244e65f76ddc278ee695e669f720cbf`, whose binary reports `bend 2.0.32`. The similarly named release tag yields an earlier version and is not used. Bend's transitive nixpkgs input has a separate lock node; pre-existing repository inputs keep their locked revisions.

```sh
devenv shell
pnpm --filter @paseo-plugins/devenv build:model
pnpm --filter @paseo-plugins/devenv verify
```

The verifier requires the exact version, executes `bend PROOF.bend`, requires a successful exit and `ALL PROOFS CHECK`, rejects `@unsafe` and all question-mark proof escapes or unfinished goals, checks claim coverage, and recompiles the artifact for a byte comparison. A missing Bend executable is a failure. `BEND_BIN` may select an explicit executable; it cannot bypass the version check.

The generator runs Bend in a fresh temporary directory, removes compiler comments with TypeScript's printer, then formats with Prettier. The generated module is checked in and bundled by Paseo's own compiler. Development compilation requires TypeScript and Prettier; installed plugin execution does not require those tools or Bend.

## What each check establishes

| Check                    | Scope                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Bend2 native proof check | Symbolic claims over the pure typed root and session models; 54 checked law/proof pairs                                            |
| Generated artifact check | Recompile the committed model and compare the generated JavaScript byte for byte                                                   |
| Real E2E                 | Isolated Paseo daemon, public RPC and CLI operations, real Web UI, Nix/devenv preparation and actual OpenCode process environments |

The former finite-trace, mutation and mocked runtime unit suites were removed in favor of [real E2E scenarios](../../../e2e/plugins.e2e.mjs). Filesystem observations, Nix evaluation, compiler correctness, operating-system process cleanup and providers honoring injected environment variables are outside the pure model proof. The SDK has no post-startup session acknowledgement: `applied` records a successful environment-returning opening hook, not confirmed provider startup; E2E separately observes selected environment markers in real provider processes.

`ALL PROOFS CHECK` is Bend2's native check. This gate does not run `--verdict` or claim Lean kernel validation; that separate path requires Lean v4.34.0. No result here proves that an already-running process loses its environment after revocation. Reload is required at that boundary.
