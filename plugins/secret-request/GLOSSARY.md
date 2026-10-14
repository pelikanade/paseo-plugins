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
The state of a request whose secret is in the handoff file. It says nothing about whether a caller received the path; see _collected_.
_Avoid_: stored, saved, provisioned

**Collected**:
The state of a delivered request whose path a live caller received. Its label is free again, so the next call under it starts a new request.
_Avoid_: read, consumed, taken

**Uncollected delivery**:
A delivery no live caller received, because the call that was waiting timed out or was cancelled. The next call under the same label hands the path over until the TTL expires.
_Avoid_: missed, orphan, abandoned, pending

**Release**:
Deleting a handoff file before its TTL, either by the agent or by the plugin.
_Avoid_: revoke, delete, forget

**Sweep**:
Deleting handoff files that are past their TTL out of the directories of earlier daemon lifetimes, at plugin start and once a minute, and removing the directories those files leave empty. Release deletes one file while its agent still exists; a sweep is what a value left by a daemon that is gone cannot escape.
_Avoid_: purge, cleanup, garbage collection

**Reveal**:
Showing a secret's value back to a human or an agent after it was submitted. This plugin has no reveal.
_Avoid_: show, display, decrypt, echo

**Chat history**:
Everything the daemon or the provider will replay into a later context: messages, tool calls, tool results and conversation attachments.
_Avoid_: transcript, log, timeline
