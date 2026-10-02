# User submissions and card updates

`publish_ui` returns a card with `revision`. Keep it for `patch_ui` and `close_ui`. Patches are atomic: an invalid operation rejects the whole batch. `get_ui_state` returns the latest card and form values.

Submission validates all declared fields, rejects unknown fields and unavailable choices, and persists a queued event before delivery. The card accepts one submission. If the agent is still running, delivery waits until it can accept a new turn. User data is preserved through client remounts and plugin reloads after submission; an unsubmitted draft stays client-local and may be lost when Chat is closed.

A submission looks like:

```json
{
  "type": "generative-ui.submit",
  "cardId": "requirements",
  "eventId": "unique-event",
  "values": { "scope": "core", "notes": "Include mobile support" }
}
```

Respond to the actual submitted values. For another question, publish another card with a new ID. Do not interpret card closure as consent, or tell the user submission reached the model before delivery is confirmed.

MCP cards can be updated with `patch_ui`. Inline cards are tied to their original assistant message and cannot be structurally updated through that tool. Publish a new MCP card if further updates are needed.
