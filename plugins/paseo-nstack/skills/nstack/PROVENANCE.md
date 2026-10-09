# Vendored nstack skills

Source: the unversioned `Skills/nstack` directory supplied for the paseo-nstack design session.
Vendored: 2026-10-09.
Local edits: 2026-10-10, approved Issues-only workflow. GitHub issue labels are canonical; designer/orchestrator agents own label creation and transitions, Ready labels signal automatically, and conflicting labels block dispatch. Filing and review use GitHub Issues exclusively. Existing design approval, permissions, caps, review, and human merge rules are retained. These Markdown sources are locally maintained adaptations, not verbatim copies.

`verify/skills.mjs` compiles every Markdown file in this directory into `server/skills.generated.ts` and fails when the generated bundle is stale.
