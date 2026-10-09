# Phase 1 reference: Grill

Detail for [nstack-design](../SKILL.md) §1 (formerly `orchestrate` Mode A, and before that the `grill-with-human` skill). The SKILL.md rules win if this file and it ever disagree.

## Upstream

The grill **is** Matt Pocock's grill, run inside nstack. Read the upstream files before your first round and follow their mechanics as written. Where nstack and upstream disagree on _how to grill_, upstream wins, with one deliberate exception: presentation. Upstream asks a whole round in plain text; nstack asks one question at a time through the host's interactive question mechanism (below). nstack also owns the transcript and handoff.

- [`grill-me`](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md): entry point; just calls `grilling`.
- [`grilling`](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md): the core loop (design tree, frontier, rounds, recommended answers, facts vs decisions, done condition).
- [`grill-with-docs`](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md): `grilling` + [`domain-modeling`](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md) (glossary challenges, fuzzy-term sharpening, edge-case scenarios, code cross-checks, ADRs sparingly). **Default to this one** for repo features.

Pinned reading: mattpocock/skills `main` @ `b0618bc` (2026-10-08). If upstream has moved, re-read it; don't trust this summary.

### The upstream loop, in brief

1. Map the feature as a **design tree**: every decision branches into the decisions that hang off it.
2. The **frontier** = every decision whose prerequisites are settled. Ask the **whole frontier in one round**. Number each question and give your **recommended answer**. A question that depends on another question still open this round belongs to a _later_ round.
3. Word each question so **"yes" accepts your recommendation** (so agreeing never means answering "no").
4. Each question lays out the **real choices** (upstream: "including multiple choices"). A recommendation with no visible alternative is not a question.
5. **Facts are your job, decisions are theirs.** Look up anything in code, docs, or the repo yourself, via a read-only helper if needed. Don't block the round on it: only questions downstream of a pending lookup wait.
6. After the answers come back, recompute the frontier and ask the next round.
7. **Done** when the frontier is empty (every branch visited, nothing silently assumed) **and the human confirms you've reached a shared understanding**. Don't start the design before that confirmation.

With `domain-modeling` on: challenge terms that conflict with `GLOSSARY.md`, propose a canonical term for fuzzy ones, invent concrete edge-case scenarios, and flag where the human's description contradicts the code. In nstack you **don't write repo files** during the grill: put resolved terms in the transcript's Glossary and ADR candidates (hard to reverse + surprising + real trade-off, all three) in Design notes. `GLOSSARY.md` / `docs/adr/` are written in the design PR (Phase 2).

## Presenting a round to the human (nstack override: one question at a time)

Upstream presents rounds as plain text. **nstack overrides that: ask the human ONE question at a time through the host's interactive question mechanism** (whatever structured way the host offers to put a question with choices to the human; plain text only if it has none). Upstream still owns _which_ questions to ask and when; this section only changes _how_ they reach the human.

1. **Open the round with one short message**: "Round N: <k> questions on <topic>." List the question titles so the human sees the whole frontier up front.
2. **Then ask the questions one at a time, in order.** Each question carries:
   - the question itself, worded so picking the recommendation is the obvious "yes";
   - the **recommended answer first**, marked "(recommended)", then the 1–3 **real alternatives**, each with a one-line trade-off;
   - room for the human to give their own answer instead;
   - a short note on the situation or facts the choice depends on;
   - multiple selection only when several answers can genuinely hold at once.
3. The human answers one question at a time. Record each answer, then ask the next question. After the last one, recompute the frontier and open the next round.
4. If the human answers in free text instead (e.g. "yes to the rest", "Q3: B"), accept it for exactly the questions it names, then go on asking whatever is still unanswered, one at a time.

Rules:

- **Banned (never bundle):** one question covering the whole round, a "Yes to all N" / "No" choice, a question missing the real alternatives, or a round posted only as a text block instead of separate questions. Each of those is a rubber stamp.
- Never offer the recommendation as the only option. If there's no real alternative, it's a fact or a settled point, not a question: record it in Context instead.
- Partial or skipped answers: settle only what was answered and carry the rest forward. Never fill in an answer yourself; re-ask it or mark it deferred in the human's words.
- The final "shared understanding?" check is also one question: "Yes, start the design" (recommended), "One more round on <open branch>", plus room for a custom answer.
- The same rules apply to every later question the human must answer (a design gap round, a budget cut pick).

## Grounding

Light grounding first: just enough to ask sharp questions (problem, touched surfaces, existing `GLOSSARY.md`/ADRs, obvious constraints). Deep grounding happens in Phase 2.

## Transcript (required artifact)

Write one durable file: `docs/design/_intake/<feature>-grill.md` in the repo (it then ships in the design PR), or `nstack-intake/<feature>-grill.md` in an intake scratch folder outside the repo if the repo write is deferred (the design header cites that path).

```markdown
# Grill transcript: <feature>

Repo: <url> Date: <ISO Asia/Shanghai> Griller: <designer>
Method: grill-with-docs (mattpocock/skills @ <sha>), asked one question at a time
Status: ready-for-design | needs-another-round
Shared understanding confirmed: "<human's words>"

## Context (facts gathered, not decisions)

- …

## Design tree

- <root decision> → <child decisions> (settled / deferred)

## Rounds

### Round 1

Q1 <title>: <options shown> (recommended: …)
A1 <human's pick or typed answer, verbatim>
…

## Settled decisions

- D1 <statement> — user-approved — chosen over <alt>: <reason, or "accepted recommendation">

## Deferred / open

- O1 … — deferred by human: "…"

## Glossary (resolved terms)

- <term>: <meaning> (avoid: <rejected synonyms>)

## Design notes

- Surfaces touched: …
- ADR candidates: …
- Prototype likely needed?: yes/no/unknown, and which open question it would settle
- Explicit non-goals: …
```

No empty Settled decisions. Approving grill answers here is not the design sign-off. Gap rounds asked later (during design) are appended as further `### Round N` entries, so the transcript stays the one record of what the human decided.
