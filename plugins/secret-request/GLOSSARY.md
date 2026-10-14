# Paseo plugins

Paseo plugins extend the Paseo daemon and app: agent-facing tools on the server side, native UI on the client side. This glossary fixes the vocabulary for the `secret-request` plugin, which lets an agent ask the user for a secret without the value ever entering conversation history.

## Secrets

**Secret**:
A user-supplied credential value — an API key, token or password — that an agent needs in order to work.
_Avoid_: credential, key, token, password, secret value

**Secret name**:
The label a request carries, for example `OPENAI_API_KEY`. In this plugin it is a label, not an environment variable.
_Avoid_: variable, env var, env name, key name

**Secret request**:
The agent's ask for one secret, with a lifecycle of its own: pending, delivered, canceled or expired.
_Avoid_: prompt, query, secret prompt

**Handoff file**:
The short-lived RAM-backed file holding a delivered secret, whose path is the only thing the agent receives. It lives under `/dev/shm` and is never written to a persistent filesystem.
_Avoid_: drop file, secret file, temp file, vault

**Delivered**:
The state of a request whose secret is in the handoff file and whose path has been returned to the agent.
_Avoid_: stored, saved, provisioned

**Release**:
Deleting a handoff file before its TTL, either by the agent or by the plugin.
_Avoid_: revoke, delete, forget

**Reveal**:
Showing a secret's value back to a human or an agent after it was submitted. This plugin has no reveal.
_Avoid_: show, display, decrypt, echo

**Chat history**:
Everything the daemon or the provider will replay into a later context: messages, tool calls, tool results and conversation attachments.
_Avoid_: transcript, log, timeline
