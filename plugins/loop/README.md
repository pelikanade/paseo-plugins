# Loop

A Paseo plugin that re-runs a prompt in the same agent on a local schedule. It is the session-scoped counterpart of Cursor's `/loop`: fixed interval or a self-paced heartbeat, optional event watcher, and it dies with the agent. It is not a cloud automation.

## Use

Install the plugin, then start a new agent so it receives the `loop` MCP server and the bundled skill.

```text
/loop 5m check deploy
/loop check deploy every 5 minutes
/loop work until tests pass
/loop 5m /foo
/loop stop
```

`/loop` with no prompt shows the usage hint. A leading or trailing interval arms a fixed loop and runs the prompt once immediately; the plugin sends the next wake only after a full interval. With no interval, the slash command asks the agent to choose a heartbeat and, when the prompt is gated on an event, a watcher.

The agent can also call `loop_arm`, `loop_status`, and `loop_stop`. `get_loop_guide` and `skill://loop/SKILL.md` serve the skill. The Loop panel shows the armed loop and can stop it.

Wakes are ordinary user messages in the same agent:

```text
AGENT_LOOP_TICK_<purpose> {"prompt":"...","reason":"interval"}
AGENT_LOOP_WAKE_<purpose> {"prompt":"...","reason":"heartbeat"}
```

`reason` is `watch` when the watcher prints a stdout line. Missed fixed ticks that arrive while the agent is busy collapse into one wake. A dynamic heartbeat is a one-shot timer armed at the end of the turn.

## Limits

- One loop per agent. Arming again replaces it and kills the previous watcher.
- Intervals are from 1 second through 7 days. There is no `--max-turns` or `--max-runtime` flag.
- The watcher is an argv array executed directly in the agent's working directory, as the daemon user. It must stay quiet until the event. Stderr does not wake the loop.
- Loops are in memory. They stop when the user or agent calls `loop_stop`, when the agent is archived, or when the plugin or daemon stops. They do not survive a restart, and they are not cloud automations.
- The MCP address and session token are stored under `PASEO_HOME/plugin-data/loop/` so a plugin reload keeps the URL that was injected into existing agents. The schedule itself is cleared on reload.
- Existing agents created before the plugin was installed do not gain the MCP server until they are recreated. Fixed `/loop` from the slash command still arms through plugin RPC. Dynamic `/loop` needs the agent to call `loop_arm`.

## Development

Paseo compiles the source. After editing the skill, run `pnpm --filter @paseo-plugins/loop build:skill`. `verify` checks the generated module against `skills/loop/SKILL.md`.
