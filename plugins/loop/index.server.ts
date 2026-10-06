import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  armRpc,
  connectionRpc,
  guideRpc,
  parseRpc,
  statusRpc,
  stopRpc,
} from "./shared/contracts";
import { parseLoop } from "./shared/parse";
import { Gateway } from "./server/gateway";
import { Loops } from "./server/loops";
import { skill } from "./server/skill.generated";
import { State } from "./server/state";

const instructions = `Local loop scheduling is available through the loop MCP server.
Re-run work in this agent with loop_arm. The bundled skill follows and is also available at skill://loop/SKILL.md through get_loop_guide.
Wakes arrive as later user messages whose sentinel line starts with AGENT_LOOP_TICK_ or AGENT_LOOP_WAKE_. Execute the payload prompt and do not start a shell, cron job, or second loop for that wake.
Loops are local to this agent. They stop on loop_stop, when the agent is archived, or when the daemon or plugin stops. They are not cloud automations.`;

export default function contribute(server: PluginServerContext) {
  const state = new State();
  const loops = new Loops();
  let gateway: Gateway | undefined;
  const service = (paseo: PluginHandlerContext["paseo"]) => {
    loops.bind(paseo);
    gateway ??= new Gateway(state, loops, paseo);
    return gateway;
  };
  server.handle(parseRpc, ({ text }) => parseLoop(text));
  server.handle(guideRpc, () => ({ text: skill }));
  server.handle(statusRpc, ({ agentId }, { paseo }) =>
    loops.status(agentId, paseo),
  );
  server.handle(armRpc, (input, { paseo }) => loops.arm(input, paseo));
  server.handle(stopRpc, async ({ agentId }, { paseo }) => {
    await loops.requireAgent(agentId, paseo);
    return loops.stop(agentId);
  });
  server.handle(connectionRpc, async ({ agentId }, { paseo }) => {
    await loops.requireAgent(agentId, paseo);
    return service(paseo).connection(await state.open(agentId));
  });
  const cleanups = [
    server.before("agent.create", async ({ request }, { paseo }) => {
      if (request.config.internal || request.config.mcpServers?.loop)
        return request;
      const token = await state.open(null);
      const connection = await service(paseo).connection(token);
      return {
        ...request,
        env: { ...request.env, PASEO_LOOP_SESSION: token },
        config: {
          ...request.config,
          systemPrompt: [request.config.systemPrompt, instructions, skill]
            .filter((part) => part !== undefined && part.length > 0)
            .join("\n\n"),
          mcpServers: {
            ...request.config.mcpServers,
            loop: {
              type: "http",
              url: connection.url,
              headers: { Authorization: `Bearer ${token}` },
              alwaysLoad: true,
            },
          },
        },
      };
    }),
    server.before("agent.session_open", async ({ request }, { paseo }) => {
      if (request.purpose === "history") return request;
      loops.bind(paseo);
      await service(paseo).start();
      const token = request.env.PASEO_LOOP_SESSION;
      if (token) {
        try {
          await state.bind(token, request.agentId);
        } catch (error) {
          console.warn(
            "loop: session bind failed",
            error instanceof Error ? error.message : "Unknown error",
          );
        }
      }
      return request;
    }),
    server.on("agent.turn_started", ({ agent }, { paseo }) => {
      loops.bind(paseo);
      loops.onTurnStarted(agent.id);
    }),
    server.on("agent.turn_ended", ({ agent }, { paseo }) => {
      loops.bind(paseo);
      return loops.onTurnEnded(agent.id);
    }),
    server.on("agent.archived", async ({ agent }) => {
      loops.stop(agent.id);
      await state.forget(agent.id);
    }),
  ];
  return async () => {
    for (const cleanup of cleanups) cleanup();
    await loops.shutdown();
    if (gateway) await gateway.shutdown();
  };
}
