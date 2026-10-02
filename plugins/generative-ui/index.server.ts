import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { Cards } from "./server/cards";
import { Gateway } from "./server/mcp";
import {
  cardRpc,
  connectionRpc,
  guideRpc,
  listRpc,
  submitRpc,
} from "./shared/contracts";
import { guide } from "./shared/guide.generated";
import { parseMessage } from "./shared/stream";

const instructions =
  "Generative UI is available through the generative-ui MCP server. When a comparison, choice, form or progress card would help the user, read get_ui_guide, then get_ui_catalog. Publish native Chat cards with publish_ui and update them with patch_ui. User submissions arrive later as ordinary messages in this same agent. Use only the declared catalog and do not wait in a blocking tool for input. Simple replies can stay text. The bundled skill is also available at skill://generative-ui/SKILL.md through MCP.";

export default function contribute(server: PluginServerContext) {
  const cards = new Cards();
  let gateway: Gateway | undefined;
  let deliveryTimer: ReturnType<typeof setInterval> | undefined;
  const service = (paseo: PluginHandlerContext["paseo"]) => {
    gateway ??= new Gateway(cards, paseo);
    deliveryTimer ??= setInterval(() => {
      cards.deliver(paseo).catch(console.error);
    }, 2000).unref();
    return gateway;
  };
  server.handle(guideRpc, () => ({ text: guide }));
  server.handle(listRpc, async ({ agentId }, { paseo }) => ({
    cards: await cards.list(agentId, paseo),
  }));
  server.handle(cardRpc, async ({ agentId, cardId }, { paseo }) => {
    await cards.agent(agentId, paseo);
    return { card: await cards.get(agentId, cardId) };
  });
  server.handle(submitRpc, async (input, { paseo }) =>
    cards.submit(input, paseo),
  );
  server.handle(connectionRpc, async ({ agentId }, { paseo }) => {
    await cards.agent(agentId, paseo);
    return service(paseo).connection(await cards.session(agentId));
  });
  const cleanups = [
    server.before("agent.create", async ({ request }, { paseo }) => {
      if (
        request.config.internal ||
        request.config.mcpServers?.["generative-ui"]
      )
        return request;
      const token = await cards.session(null);
      const connection = await service(paseo).connection(token);
      return {
        ...request,
        env: { ...request.env, PASEO_GENERATIVE_UI_SESSION: token },
        config: {
          ...request.config,
          systemPrompt: [request.config.systemPrompt, instructions]
            .filter(Boolean)
            .join("\n\n"),
          mcpServers: {
            ...request.config.mcpServers,
            "generative-ui": {
              type: "http",
              url: connection.url,
              headers: { Authorization: `Bearer ${token}` },
            },
          },
        },
      };
    }),
    server.before("agent.session_open", async ({ request }, { paseo }) => {
      if (request.purpose === "history") return request;
      await service(paseo).start();
      const token = request.env.PASEO_GENERATIVE_UI_SESSION;
      if (token) await cards.bind(token, request.agentId);
      return request;
    }),
    server.on("agent.turn_ended", async ({ agent, timeline }, { paseo }) => {
      for (const item of timeline) {
        if (item.type !== "assistant_message") continue;
        for (const segment of parseMessage(item.text, true)) {
          if (segment.type !== "ui" || !segment.complete || segment.error)
            continue;
          try {
            await cards.publish(
              agent.id,
              segment.cardId,
              segment.spec,
              "inline",
              paseo,
            );
          } catch (error) {
            console.warn(
              "generative-ui card registration failed",
              error instanceof Error ? error.message : "Unknown error",
            );
          }
        }
      }
      await cards.deliver(paseo);
    }),
    server.on("agent.archived", async ({ agent }) => cards.forget(agent.id)),
  ];
  return async () => {
    clearInterval(deliveryTimer);
    for (const cleanup of cleanups) cleanup();
    await gateway?.shutdown();
    await cards.shutdown();
  };
}
