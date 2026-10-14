import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Gateway } from "./server/mcp";
import { Requests } from "./server/requests";
import { Storage } from "./server/storage";
import { cancelRpc, statusRpc, submitRpc } from "./shared/contracts";
import { MCP_SERVER_NAME, SESSION_ENV_KEY } from "./shared/protocol";

const instructions =
  "The secret-request MCP tool asks the user for one secret; read its description before calling it and follow it exactly, above all the rule that the value must never be echoed, logged, measured or copied, and that a call which times out or is canceled is retried under the same label instead of being abandoned.";

export default function contribute(server: PluginServerContext) {
  const storage = new Storage();
  const requests = new Requests(() =>
    storage.read((database) => database.handoffId),
  );
  const gateway = new Gateway(requests, storage);
  requests.prepare().catch(console.error);
  gateway.start().catch(console.error);
  server.handle(submitRpc, (input, context) => {
    gateway.attach(context.paseo);
    return requests.submit(
      input.agentId,
      input.requestId,
      input.value,
      context.paseo,
    );
  });
  server.handle(cancelRpc, (input, context) => {
    gateway.attach(context.paseo);
    return requests.cancel(input.agentId, input.requestId, context.paseo);
  });
  server.handle(statusRpc, (input, context) => {
    gateway.attach(context.paseo);
    return requests.status(input.agentId, input.requestId);
  });
  const cleanups = [
    server.before("agent.create", async ({ request }, { paseo }) => {
      if (
        request.config.internal ||
        request.config.mcpServers?.[MCP_SERVER_NAME]
      )
        return request;
      gateway.attach(paseo);
      const token = await gateway.createToken();
      const url = await gateway.url();
      return {
        ...request,
        env: { ...request.env, [SESSION_ENV_KEY]: token },
        config: {
          ...request.config,
          systemPrompt: [request.config.systemPrompt, instructions]
            .filter(Boolean)
            .join("\n\n"),
          mcpServers: {
            ...request.config.mcpServers,
            [MCP_SERVER_NAME]: {
              type: "http",
              url,
              headers: { Authorization: `Bearer ${token}` },
            },
          },
        },
      };
    }),
    server.before("agent.session_open", async ({ request }, { paseo }) => {
      if (request.purpose === "history") return request;
      gateway.attach(paseo);
      const token = request.env[SESSION_ENV_KEY];
      if (token) await gateway.bind(token, request.agentId);
      return request;
    }),
    server.on("agent.turn_started", (_event, context) => {
      gateway.attach(context.paseo);
    }),
    server.on("agent.archived", ({ agent }) => requests.abortAgent(agent.id)),
  ];
  return async () => {
    for (const cleanup of cleanups) cleanup();
    requests.close();
    await gateway.shutdown();
  };
}
