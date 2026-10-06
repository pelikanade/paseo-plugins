# Filler noise

Hides assistant text rows that carry no content: a text part made only of dots, ellipses and
whitespace, such as the `.` that DeepSeek models emit on tool-call turns.

## Why the rows exist

OMP promotes an assistant tool-call turn with no text to `content: "."` on the wire so DeepSeek
accepts it (`requiresAssistantContentForToolCalls`). The model then mirrors that filler into its own
visible output, and the dot is persisted in the session as a real text part. OMP's terminal UI hides
such text (`canonicalizeMessage`), but Paseo renders every text part it receives, so each filler
becomes its own chat row.

## What it does

Registers one client-side timeline transformer for `assistant_message`. The transformer returns
`items: []` when the item's text matches `^[.\u2026\s]*[.\u2026][.\u2026\s]*$`, which removes the
row; every other text keeps the source item. It runs on fetched history and on live updates, so it
covers both a resumed session and streaming text, and it hits no provider or daemon code.

## Install

```sh
paseo plugin install "$PWD/plugins/filler-noise"
paseo plugin ls
```

## Limits

- The daemon timeline, session files and `paseo agent logs` keep the original text; only the app's
  rendered transcript is filtered.
- Only dots, ellipses and whitespace are matched. A message that mixes filler with prose renders
  unchanged, including the remaining dots.
- Whitespace-only assistant text is left to Paseo's own empty-row handling.
