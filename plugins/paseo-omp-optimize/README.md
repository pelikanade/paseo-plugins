# OMP optimize

## Purpose

Improve the OMP experience inside Paseo. Paseo presents every provider through the same generic session and timeline model, so parts of what an OMP session produces can be dropped, flattened, or shown in a form that costs the user a step. This plugin closes those OMP-specific gaps so an OMP session in Paseo keeps the fidelity and ergonomics it has when run directly, without giving up Paseo's session handling.

Scope is what OMP does that Paseo's generic integration does not handle well. General Paseo UI improvements, other providers, and defects OMP itself should fix do not belong here.

## Current features

### Tool intents

OMP labels every tool call with a short `intent`, such as `Listing plugin files`. Paseo's OMP integration keeps the tool arguments but drops the intent, so the transcript shows what ran but not what the agent was trying to do. This plugin projects each intent into the transcript as a muted row directly after its tool row.

During a live OMP turn, the daemon side tails the agent's OMP session JSONL, reads `intent` from the assistant tool call and from `tool_execution_start`, waits for Paseo to publish the matching `tool_call` row, then appends a plugin timeline row with the stable id `intent:<callId>`. A watcher starts before the first turn of a new agent, at each turn of an agent without one, and through a client startup RPC for active OMP agents. The row is daemon-owned, survives timeline refetches and reconnects, and updates by id.

### Image reads

OMP's `Read` tool reports an image as a text line such as `Read image file [image/png]`. Paseo's tool row keeps only that text, so the image itself never appears. This plugin turns the finished row into the image.

## How it works

### Intents

The server plugin resolves the OMP session file from the agent's `persistence.nativeHandle` and tails it in 1 MiB chunks, parsing only assistant `toolCall` entries and `tool_execution_start` custom entries. It deduplicates by tool call id. Before publishing, it polls the agent timeline for the matching `tool_call` row so the intent lands after that row instead of before it.

Intent rows set `sequence: "tool"`, so a host that supports the flag stacks them with the native tool sequence and keeps the normal turn-footer margin. The renderer matches the native tool row's height, type and icon alignment and never overrides host row gaps. Older hosts strip the unknown item field and render the row with generic plugin spacing.

### Images

A client timeline transformer watches completed `tool_call` rows whose detail is a read and whose content starts with `Read image file [image/...]`. It replaces that row with a plugin row carrying the file path, the original marker text and the dimensions OMP reported.

The renderer asks a daemon RPC for the file. The RPC resolves a relative path against the agent's working directory, reads at most 10 MiB, identifies PNG, JPEG, GIF, WebP, AVIF and BMP by signature with an extension fallback, and returns base64. The client displays it as a data URI, scaled to at most 560 by 480 pixels on desktop and 280 by 320 in the compact layout. If reading or decoding fails, the row falls back to OMP's original text plus the error.

The plugin reads the original file on the daemon host, not OMP's transcoded image blob. A PNG that OMP converts to WebP is therefore displayed from its source.

## Limits

- Intents are projected only for live OMP turns. Imported and finished sessions are not backfilled. A watcher attached mid-turn starts reading at the last user message, so intents already produced in that turn are recovered.
- Intents appear only for tool calls that Paseo publishes as `tool_call` rows. OMP `todo` calls are mapped to the todo timeline and keep no intent row.
- Subagent sessions keep their own OMP session files; this plugin does not project their intents into the parent transcript.
- Daemon-pushed intent rows live in the daemon's in-memory timeline. They survive refetch and reconnect but not a daemon restart.
- Only OMP image reads are replaced. Text reads, remote URLs and `xd://` device reads keep Paseo's normal rows.
- Images larger than 10 MiB are not loaded.
- The image file must still exist when the row renders. Deleting it leaves the original marker and an error.
- The daemon reads session and image files with the permissions of the daemon user.

## Install

```sh
paseo plugin install "$PWD/plugins/paseo-omp-optimize"
paseo plugin ls
```
