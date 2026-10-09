# Grill transcript: nstack settings revamp

Repo: paseo-plugins · Date: 2026-10-10 · Designer: Codex
Method: nstack-design / grill-with-docs; mattpocock/skills @ b0618bc, one question at a time
Status: ready-for-design
Shared understanding confirmed: "Yes, draft the plan"

## Context

- The existing Automatic agent settings dialog renders the provider/model catalog twice as chip grids, for Plugin default and This workspace.
- Both grids render `option.label`; the server already supplies the complete `option.model` string and uses provider/model identity for selection.
- The user reports two indistinguishable `omp - GPT-6-Astra` entries backed by different model routes.
- New repository inputs currently open empty. Connection testing requires both repository inputs, so it cannot bootstrap their defaults.
- `nstack.panel` refreshes every five seconds. Repository suggestions should be requested when opening settings, independently of panel polling.
- The installed SDK exposes workspace metadata including `projectRootPath` and `workspaceDirectory`. GitHub identity is available through the existing server-side `github.login()` interface.
- The current Issue labels section is explanatory text. Issue workflow rules live in the watcher and vendored skills.

## Design tree

- Searchable model selection — settled: both existing selectors; keep workspace inheritance.
  - Duplicate friendly labels — settled: show and search the full model ID on results and selected values.
- Repository suggestions — settled: authenticated GitHub username and main repository folder; editable defaults for new bindings only.
  - Worktree folder ambiguity — settled: main repository folder.
  - Saved values and edits — settled: preserve saved values and anything already typed.
- Issue-label section — settled: remove from settings.
- Delivery — settled: draft the plan and visual proposal; production implementation is outside this planning turn.

## Rounds

### Round 1

Q1: "For worktrees, should the repository default use the main repository’s folder name?"

Options: Main repository folder (recommended: worktree settings-revamp still suggests gh-username/paseo-plugins); Current workspace folder (literal worktree directory name).

A1: "Main repository folder"

The first scope-confirmation request was interrupted before an answer. It did not establish approval.

User addition, verbatim:

> add: the picker should also show the full model id. I use multi providers in omp of the same model and currently all I can see is two identical omp - GPT-6-Astra

The designer clarified that every result and selected value would show the full model ID; search would match it; long IDs would wrap rather than rely on truncation or tooltips.

Q2: "Does this updated scope capture the revamp, including disambiguating identical model names?"

Options: Yes, draft the plan (recommended: both selectors searchable; full model IDs visible and searchable; editable new-binding defaults from GitHub username and main repo folder; issue-label section removed); Revise the scope.

A2: "Yes, draft the plan"

## Settled decisions

- D1 — user-approved: make both current model selectors searchable, keeping Use plugin default for the workspace override. Accepted the stated scope.
- D2 — user-approved: display and search full model IDs in results and selected values, including long IDs and identical friendly labels. Requested explicitly and accepted the clarified scope.
- D3 — user-approved: suggest the authenticated GitHub username and main repository folder name for new bindings; use the main folder for worktrees. Chosen over the literal worktree folder.
- D4 — user-approved: suggestions remain editable and never overwrite saved settings or user edits. Accepted the stated scope.
- D5 — user-approved: remove the Issue labels section from settings. Requested explicitly.

## Deferred / open

None for the plan. Layout, module interfaces, complexity budget, acceptance scenarios, and slices remain design-proposed until design approval.

## Glossary

No new project-specific terms. Binding, Paseo workspace, Paseo project, and workflow state retain their existing meanings in GLOSSARY.md. The model ID is the existing provider-supplied `model.id`, not the friendly label or a reconstructed route.

## Design notes

- Surfaces: existing settings dialog; new on-open repository-suggestion RPC; current model-choice persistence.
- Visual artifact: a static design mock showing the compact settings form and expanded results with duplicate friendly labels and different full IDs. It is not a running plugin or a behavioral prototype.
- ADR candidates: none; the choices are local and reversible.
- Non-goals: changing model discovery, agent permissions, scheduling, issue workflow labels, or the existing host timeline-persistence limitation.
