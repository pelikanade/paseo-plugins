# PR body for humans (shared reference)

Shared by `nstack-design` (design PRs) and `pr-with-evidence` (implementation and other review PRs). Two byte-identical copies, edit both together or neither: `nstack-design/references/pr-body.md` and `pr-with-evidence/references/pr-body.md` (the old `orchestrate` and `design-first-feature` copies are retired).

Evidence base: vault `Digests/2026-10-09 Design PR description for humans.md` (pinned 2026-10-09). The goal: the owner learns **what, what's decided, and what it looks like** in about 30 seconds, and a reviewer (Freezy) can check the shape from the body text alone.

## Rules that matter

1. **Bottom line first.** Line 1 is one sentence: what the feature is plus what is true after merge. A reader who stops there is still right. Outcome-shaped, not mechanism-shaped.
2. **The artifact is the second thing on the page, inline, under `## Outcome`.** CLI: a fenced `console` block with real `$ command` lines and their output. GUI: one embedded image or one clip ≤30 s. A link to `docs/design/…-artifact.md` does not count. Label its provenance.
3. **Decisions are ≤5 one-line bullets**, "X over Y because Z", each tagged. Then ≤3 checkboxes under "Your call before merge" (at most one slice-level). Design PRs add one `Slices:` line (count + critical path, never the list). Everything else is the design doc's job.
4. **Hard budget above the fold:** ≤40 rendered lines and ≤1,200 characters of prose before the first `<details>`, not counting the artifact block. Artifact ≤20 console lines, or 1 image, or 1 clip ≤30 s.
5. **Fixed shape beats a length cap.** No file-by-file changelog, no process narration ("I checked X, then Y", "This is the design-first gate…"), no emoji, no badges you added, no empty or "N/A" sections.
6. **Never invent the why.** If the transcript or design doc gives no reason, write "X over Y" without "because". Never tag your own pick _you approved_.
7. **Make it checkable** (B1–B8 below). Run them on your draft before publishing.

## Design PR template (nstack-design)

````markdown
**<what the feature does, after merge, in one sentence>.** Merging this PR approves the design.

## Outcome

```console
$ <real command, happy path>
<its output>
$ <real command, main error path>
<its output>
$ echo $?
1
```

<sub>Source: <provenance label> · full session in the fold below</sub>

## Decided

- D<n> <X> over <Y> because <Z> (_you approved_)
- P<n> <X> over <Y> because <Z> (_proposed; merge = approve_)

## Your call before merge

- [ ] <only things the merge itself ratifies> (or: Nothing beyond merge.)

Slices: <n> (budget ≤ <m>) · critical path: <1 → 3 → 4> · list: design doc §7

Design: `docs/design/<feature>.md` · Issue: #<n> | none · Prototype: proto/<feature>@<sha> | none · Merge = sign-off

<details><summary>Why this shape (<n> alternatives)</summary>…</details>
<details><summary>Full CLI session / all screens</summary>…</details>
<details><summary>Layout, public surface, budget</summary>…</details>
<details><summary>Glossary / ADR changes</summary>…</details>
<details><summary>Design self-check</summary>…</details>
````

Per block:

- **Lead:** ≤2 sentences, ≤300 chars, not a heading, never opens with "This PR" or "I". Ends with "Merging this PR approves the design."
- **Outcome:** exactly one artifact: happy path plus the most important error path.
  - CLI: ` ```console ` with `$ ` prompts so input and output can't be confused. Show exit codes via `$ echo $?` or a trailing `# exit 1` comment on the `$` line. Not `# stdout:` comment lines: they can't be checked or re-run.
  - GUI: one image (a before/after pair in a 2-column table for redesigns) or one clip ≤30 s.
  - Always a `<sub>Source: …</sub>` line. Allowed labels: `prototype <branch>@<sha> run <date>`, `scaffold @<sha>`, `mock/wireframe`, `intended (spec)`. Hand-typed output with no code behind it is `intended (spec)`.
  - Never inside `<details>`: it collapses by default and nobody opens it.
- **Decided:** use the design doc's own IDs (D-, P-) so they can be cross-checked. ≤120 chars each. _you approved_ only for transcript-settled `user-approved` D-lines; every designer pick is _proposed; merge = approve_.
- **Your call:** ≤3 checkboxes, only decisions the merge ratifies (proposed edge cases, budget, cuts, at most one slice-level call if there is a real one). None → "Nothing beyond merge."
- **Slices line:** the slice count, the budget, and the critical path in one line. Merging approves the slices in design doc §7 and is the permission to file them; the body never reprints the list.
- **Binding line:** `Design: <path>` (no `@sha` yet; the merge SHA is recorded after merge) · Issue · Prototype · Merge = sign-off.
- **Fold:** one `<details>` per question a reviewer _might_ have: alternatives, full session, layout/S-list/budget, glossary/ADRs, verification or self-check.

## Implementation / other review PR template (pr-with-evidence)

```markdown
**<what now works, or the symptom fixed>.** Implements design D<a>–D<b>.

## Outcome (captured at `<short sha>` = PR head)

![<what the image shows>](./artifacts/after.png) ← `gh --attach` rewrites this path
(fix: Before | After table from the same scenario; CLI: a console block as above)

## Deviations from design

None. (or: A<n> <what>: seed, no amendment needed / amendment proposed)

## Where to look

1. `<file>` `<symbol>`: <why it's the riskiest part>
2. <one-way door, migration, concurrency edge>

Design: `<path>@<merge sha>` · Closes #<n> · Verification: <N> PASS, <M> Not run @ <short sha> (see fold)

<details><summary>Verification record @ <sha></summary>…</details>
<details><summary>Conformance self-report</summary>Paths ⊆ layout: … · New public surface: … · Budget: files a/b, LOC c/d</details>
<details><summary>Change map / diagrams / boundaries</summary>…</details>
```

|                     | Design PR                                                                                                    | Implementation / other review PR                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Line 1              | What the feature _will_ do + "Merging this PR approves the design."                                          | What _now_ works (or the symptom fixed)                                                                |
| Outcome artifact    | Intended or prototype output; `Source:` provenance label required                                            | Real capture **at the head SHA**; fixes show Before/After from the same scenario                       |
| Middle section      | **Decided** (D/P lines) + **Your call before merge** + `Slices:` line                                        | **Deviations from design** (amendment or "None") + **Where to look** (1–3 pointers, never a file list) |
| Verification record | Usually tiny (design self-check, `check-design` CI), in the fold                                             | Required, in the fold; its one-line headline (PASS / Not run counts @ sha) visible above the fold      |
| Media in the repo   | Design assets **may** be committed under `docs/design/assets/<feature>/`: they are part of the signed design | **Never commit PR-only captures**; `--attach` them                                                     |
| Bugfix shape        | n/a                                                                                                          | "Fixes a bug where <symptom>" → Before → After → test that fails on `main` and passes here             |

Small review PRs (dependency bumps, refactors, docs): 1–2 sentences, no headers, under ~300 chars. Nothing observable → one line instead of Outcome: "No behavior change: refactor of X; tests unchanged."

## Getting media in

- **CLI work: text first.** A `console` block renders everywhere (GitHub, Origin, email), is searchable, and is checkable. When a prototype or scaffold can run, capture output from a real run (e.g. Showboat `exec` → `verify`) instead of hand-typing it; otherwise label it `intended (spec)`.
- **Terminal motion** (TUI, spinners, prompts): VHS `.tape` → GIF/MP4 (commit the tape, not the GIF), or `asciinema rec` → `agg` → GIF. A `.cast` link is a link and fails.
- **GitHub: `gh pr create|edit --body-file body.md --attach <file>`** (also `gh pr comment`, `gh issue …`). Requirements: gh ≥ 2.99.0 (check `gh pr create --help` advertises `--attach` before relying on it), write access, a user OAuth token or PAT (GitHub App tokens and GHES unsupported), ≤10 MB per image/GIF, ≤50 files per call. A local path already referenced in the body (`![alt](./x.png)`) is rewritten in place; a video must be alone in its paragraph. Partial failure exits non-zero but keeps earlier uploads: re-read the PR, don't assume "no PR". Inspect every image for secrets/PII first: there is no delete endpoint, and public-repo attachments are public.
- **`--attach` can't apply** (old gh, App token, GHES, >10 MB): same-repo orphan assets branch or hidden ref, embedded as `https://github.com/<owner>/<repo>/blob/<sha>/<file>?raw=true` (private-repo rendering unverified: test once), or stop and report local paths (pr-with-evidence stop rule).
- **Origin:** body is a plain string ≤65,536 chars; no upload/attachment API. CLI → console block. GUI design PRs → commit the capture under `docs/design/assets/<feature>/`, embed it by relative path _and_ name the path in the `<sub>Source:` line, so a broken render still points somewhere. Image and `<details>` rendering in Origin PR descriptions is unverified. GUI-heavy implementation PRs → prefer a GitHub-mirrored repo where `--attach` works.
- **Hosts that wrap a generated PR body in begin/end marker comments:** keep your body inside the markers and leave the host's footer badges alone. A host option that posts artifacts at unguessable public URLs is fine for public repos, the owner's call for private ones.
- **Never (PixelLeak):** create repos, gists, releases or tags to host evidence; external image hosts (imgur, `gitshot`, …); another owner's repo; cookie/session-based uploaders (credential scraping); undocumented upload endpoints; committing PR-only binaries to the feature branch.

## Self-check before publishing: Freezy B1–B8

Run on the body text (strip HTML comments; parse only between the host's body markers when present). Freezy runs the same list: **blocking for design PRs**, advisory for implementation PRs unless B-scenarios need visual evidence.

- **B1 Lead:** first non-blank line ≤300 chars, not a heading, no "This PR" / "I " process opener.
- **B2 Outcome:** `## Outcome` within the first 15 non-blank lines, and the section (to the next `## `) contains at least one of: a fenced `console|shell|sh|bash|text` block with ≥1 line starting `$ ` and ≥1 line that doesn't; an embedded `user-attachments` image/video; an embedded image pointing at this repo (`blob/<sha>/…?raw=true` or relative `docs/design/assets/…`). **FAIL** when it has no console block and no media, when the artifact sits inside `<details>`, or when it is link-only (a `[x](…)` link, a `.cast`/`.md`/`.mp4` link, a bare path).
- **B3 Provenance:** design PR has a `Source:` line; implementation PR says "captured at <sha>" and that sha == head.
- **B4 Budget:** prose chars before the first `<details>` (minus the Outcome artifact) ≤1,200; ≤40 rendered lines; Decided ≤5; Your call ≤3 (≤1 slice-level). **FAIL** when the top is over budget.
- **B5 Decided IDs** exist in the design doc §3 at head; _you approved_ only on D-lines tagged `user-approved` there.
- **B6 Binding:** `Design: <path>` (design PR) / `Design: <path>@<sha>` + Closes/Related (implementation PR). Design PR also has one `Slices: <n> … critical path: …` line above the fold and no numbered slice list.
- **B7 Hosts:** no gist, other-owner repo, `raw.githubusercontent.com/<other owner>`, `_gitshot`, imgur or other external image host. **FAIL** when an image is hosted off-repo (advisory on public repos).
- **B8 No leftovers:** no `TBD`, template comments, empty headings, "N/A" sections.

Verdict: PASS / FAIL (<items>) / INCONCLUSIVE (Origin render unknown, image not fetchable). Text checks cannot prove the image shows what the text claims, that console output is real (only a `showboat verify` check run proves that), or how Origin renders images and `<details>`.

## Anti-patterns (self-review)

- Essay instead of decision; "what" without "why".
- Invented facts or invented reasons; a wrong first line sinks the PR.
- Polish as review theater: "Where to look" and "Deviations" name the risky part, they don't reassure.
- File-by-file changelog (the Files tab already shows it). A parser or CLI flag doesn't need a PNG: use a console block.
- Process narrative instead of the feature's behavior.
- Ceremony sections, emoji walls, generated-by badges.
- Video as a substitute for line 1 (you can't skim a video).
- A length cap with no fixed shape.
- Leaking evidence through public hosts.
