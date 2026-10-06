import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Environments } from "./server/environment";
import { TrustReloads } from "./server/reload";
import { findRoot } from "./server/project";
import { instructions } from "./server/instructions";
import { mcpConfig } from "./server/mcp";
import { skill } from "./server/skill.generated";
import {
  allowRpc,
  loadRpc,
  settingsDefinition,
  settingsSchema,
  statusRpc,
} from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  let settings = settingsSchema.parse({});
  const environments = new Environments(settings);
  const reloads = new TrustReloads(environments, () => settings);
  const registered = server.registerSettings(settingsDefinition);
  const configure = (state: Awaited<ReturnType<typeof registered.read>>) => {
    if (state.status === "ready") {
      settings = state.values;
      environments.configure(settings);
    } else console.warn(`devenv settings invalid: ${state.error}`);
  };
  const ready = registered.read().then(configure).catch(console.error);
  const cleanups = [registered.subscribe(configure)];
  cleanups.push(
    server.before("agent.create", async ({ request }) => {
      await ready;
      const root = findRoot(request.config.cwd);
      if (root === null) return request;
      return {
        ...request,
        config: {
          ...request.config,
          systemPrompt: [request.config.systemPrompt, instructions, skill]
            .filter(Boolean)
            .join("\n\n"),
          mcpServers: {
            devenv: mcpConfig(root, settings.devenvBin),
            ...request.config.mcpServers,
          },
        },
      };
    }),
  );
  cleanups.push(
    server.before("agent.session_open", async ({ request }, { signal }) => {
      await ready;
      if (request.purpose === "history") return request;
      try {
        const env = await environments.open(
          request.agentId,
          request.cwd,
          request.env,
          signal,
        );
        if (env.PASEO_DEVENV_STATUS === "ready")
          reloads.applied(request.agentId);
        return {
          ...request,
          env,
        };
      } catch (error) {
        console.warn("devenv: session environment unavailable", error);
        return request;
      }
    }),
  );
  cleanups.push(
    server.on("agent.archived", ({ agent }) => {
      reloads.forget(agent.id);
      environments.forget(agent.id);
    }),
  );
  server.handle(statusRpc, async ({ agentId }, { paseo }) => {
    await ready;
    const agent = await paseo.agents.ref(agentId).refresh();
    if (!agent) throw new Error("Unknown agent");
    return reloads.view(agentId, agent.agent.cwd);
  });
  server.handle(allowRpc, async ({ agentId }, { paseo }) => {
    await ready;
    const agent = await paseo.agents.ref(agentId).refresh();
    if (!agent) throw new Error("Unknown agent");
    await reloads.allow(agentId, agent.agent.cwd, paseo);
    return reloads.view(agentId, agent.agent.cwd);
  });
  server.handle(loadRpc, async ({ agentId }, { paseo }) => {
    await ready;
    const agent = await paseo.agents.ref(agentId).refresh();
    if (!agent) throw new Error("Unknown agent");
    environments.load(agent.agent.cwd, true).catch(console.error);
    return reloads.view(agentId, agent.agent.cwd);
  });
  let shutdown: Promise<void> | undefined;
  return () => {
    shutdown ??= (async () => {
      for (const cleanup of cleanups) await cleanup();
      await Promise.all([reloads.close(), environments.close()]);
    })();
    return shutdown;
  };
}
