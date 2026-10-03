# Generative UI

A Paseo plugin for native interactive cards in Chat. Uses json-render core and React Native 0.21.0 with Paseo 0.10.2. The plugin owns its component catalog, validates each component and action, and ships an Agent-facing skill.

## Use

Install the plugin through Paseo's plugin manager. New agents receive the `generative-ui` MCP server and a short instruction pointing to `get_ui_guide`. Ask the agent for a comparison, metrics, progress, choices or a form. `get_ui_catalog` describes the actual supported components.

Existing agents can use `/ui <what to present>` for streamed inline UI, or open **Generative UI cards** from Command Center. Their existing MCP configuration is not automatically rewritten. The skill is served by `get_ui_guide` and the MCP resource `skill://generative-ui/SKILL.md`; it is also included under `skills/generative-ui/` for provider-native skill discovery where supported. Installing a Paseo plugin alone does not register that folder as a native provider skill.

The native catalog includes Card, Stack, Text, Heading, Divider, Metric, Badge, Progress, KeyValue, Table, ChoiceGroup, TextInput, Checkbox and Button. It accepts `$state` and `$bindState`, state-based visibility, and the explicit submit action. Colors come from Paseo's theme. Unsupported json-render features are rejected rather than silently advertised.

## Tools and protocol

- `get_ui_guide` reads the packaged skill and examples.
- `get_ui_catalog` returns props schemas and supported actions.
- `publish_ui` creates a complete card with a unique ID.
- `patch_ui` applies an atomic batch at the expected revision.
- `get_ui_state` reads the card and form values.
- `close_ui` disables a card at the expected revision.

All tools are bound to the owning agent through a persisted bearer token. The MCP server binds loopback, checks Host and rejects browser Origin requests. It retains its port across plugin reloads. An occupied retained port reports an error instead of silently invalidating existing agent configurations.

For progressive assistant text, use the version 1 `paseo-ui` fence described in [the bundled skill](skills/generative-ui/SKILL.md). Raw text remains in canonical assistant history. The client transforms only explicitly marked messages. Mixed prose is rendered as selectable native text, not host Markdown. Incomplete or invalid UI is read-only and reports completion errors. Inline cards are registered from completed agent turns; structural MCP updates apply to MCP cards only.

The plugin limits specs to 60 KB, 100 elements and depth 12. It rejects cycles, invalid references, unsafe paths, undeclared components/actions and malformed props. Supported patch operations are add, replace and remove; replace/remove targets must exist and duplicate array additions are preserved. States and events are stored under `PASEO_HOME/plugin-data/generative-ui/` with private permissions and atomic writes.

## Submission

Bind direct `/form/field` values and use a Button with `on.press.action` equal to `submit`. Submitted fields are validated on the server, saved, and sent as a regular user message to the same agent. If the agent is busy, delivery waits for a later turn completion. Submission is accepted once per card and retried with the same event/message ID. A crash between provider acceptance and marking the event sent can still require a retry; provider-specific message deduplication is not an exactly-once guarantee.

Cards and submitted values survive plugin reloads and daemon restarts. When a session reopens, the plugin reads its restored timeline and appends missing or outdated MCP cards from persisted state, preserving their revisions, submitted values and closed status. Restored cards may follow the loaded history because the SDK appends timeline items. Existing matching cards are retained. Inline cards stay in their original assistant messages.

Unsubmitted drafts are client-local, preserved across ordinary card updates but not guaranteed after closing Chat. Streaming, closed and submitted cards disable input. No UI action executes arbitrary code or automatically approves other actions.

## Development and verification

Paseo compiles the source; no plugin bundler is required. Host React, React Native and Zod remain development dependencies. Each runtime stays in client, server or shared directories.

After editing the skill or examples, run `pnpm --filter @paseo-plugins/generative-ui build:guide`. The generated neutral module lets the compiled plugin serve its skill without depending on its install directory. `verify` checks it against the packaged source files.

Run the affected real daemon/browser E2E scenario, then `pnpm format` and `pnpm check`. Tests exercise every one of the 14 catalog components through the actual MCP transport and Web UI, plus plugin RPC, atomic patches, form submission, plugin reload and full daemon restart with Chat history synchronization. Coverage is compared with the real catalog so adding an untested component fails the scenario. Live model generation and iOS/Android device rendering require separate validation; neither is represented by a mocked provider.

Research sources: [json-render documentation](https://json-render.dev/llms.txt), [json-render v0.21.0](https://github.com/vercel-labs/json-render/releases/tag/v0.21.0), [Paseo plugin reference](https://paseo.sh/docs/plugins/reference). json-render is Apache-2.0 licensed.
