import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  inject,
  settingsDefinition,
  settingsSchema,
} from "./shared/paseo-first";
import type { Injection } from "./shared/paseo-first";
import { STATE_ENV_KEY, parseState, statusRpc } from "./shared/status";
import type { DirectiveState } from "./shared/status";

function stateOf(result: Injection): DirectiveState {
  switch (result.kind) {
    case "disabled":
      return "disabled";
    case "present":
      return "present";
    case "applied":
      return result.source;
  }
}

export default function contribute(server: PluginServerContext) {
  let settings = settingsSchema.parse({});
  const states = new Map<string, DirectiveState>();
  const registered = server.registerSettings(settingsDefinition);
  const configure = (state: Awaited<ReturnType<typeof registered.read>>) => {
    if (state.status === "ready") settings = state.values;
    else console.warn(`paseo-omp-compat settings invalid: ${state.error}`);
  };
  const ready = registered.read().then(configure).catch(console.error);
  const cleanups = [registered.subscribe(configure)];
  cleanups.push(
    server.before("agent.create", async ({ request }) => {
      try {
        await ready;
        const result = inject(request.config.systemPrompt, settings);
        const env = { ...request.env, [STATE_ENV_KEY]: stateOf(result) };
        switch (result.kind) {
          case "disabled":
          case "present":
            return { ...request, env };
          case "applied":
            return {
              ...request,
              env,
              config: { ...request.config, systemPrompt: result.systemPrompt },
            };
        }
      } catch (error) {
        console.error("paseo-omp-compat: system prompt unchanged", error);
        return request;
      }
    }),
  );
  cleanups.push(
    server.before("agent.session_open", ({ request }) => {
      try {
        if (!(STATE_ENV_KEY in request.env)) return request;
        const marker = request.env[STATE_ENV_KEY];
        const env = Object.fromEntries(
          Object.entries(request.env).filter(([key]) => key !== STATE_ENV_KEY),
        );
        const state = parseState(marker);
        if (state !== null) states.set(request.agentId, state);
        return { ...request, env };
      } catch (error) {
        console.error("paseo-omp-compat: session environment unchanged", error);
        return request;
      }
    }),
  );
  cleanups.push(
    server.on("agent.archived", ({ agent }) => {
      states.delete(agent.id);
    }),
  );
  server.handle(statusRpc, async ({ agentId }) => {
    await ready;
    return { enabled: settings.enabled, state: states.get(agentId) ?? null };
  });
  return async () => {
    for (const cleanup of cleanups) await cleanup();
  };
}
