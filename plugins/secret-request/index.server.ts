import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Gateway } from "./server/mcp";
import { Requests } from "./server/requests";
import { Storage } from "./server/storage";
import {
  cancelRpc,
  connectionRpc,
  statusRpc,
  submitRpc,
} from "./shared/contracts";
import { MCP_SERVER_NAME, SESSION_ENV_KEY } from "./shared/protocol";

const instructions = [
  "The secret-request MCP server asks the user for one secret (API key, token, password) without the value ever entering this conversation.",
  "Call request_secret with a short label and the reason; it blocks until the user answers, cancels or the request is gone.",
  "The result is a path to a RAM-backed file, never the value: use $(cat <path>) inside the command that needs it, and never print, log, echo or copy what you read.",
  "Never report the value's length, a prefix, a suffix or a hash of it either: size and fragments are metadata that narrows a guess, so keep them out of the conversation as well.",
  "The card is a single-line masked field, so a multi-line secret (PEM, SSH key) either has to be base64-encoded by the user — put the exact command in hint — or arrives with its newlines stripped and you repair it.",
  "The file is deleted 15 minutes after delivery; call secret_release as soon as you are done with it.",
].join(" ");

export default function contribute(server: PluginServerContext) {
  const storage = new Storage();
  const requests = new Requests(() =>
    storage.read((database) => database.handoffId),
  );
  let gateway: Gateway | undefined;
  const service = (paseo: PluginHandlerContext["paseo"]) => {
    gateway ??= new Gateway(requests, storage, paseo);
    return gateway;
  };
  requests.initialize().catch(console.error);
  server.handle(connectionRpc, ({ agentId }, { paseo }) =>
    service(paseo).connection(agentId),
  );
  server.handle(submitRpc, (input, { paseo }) =>
    requests.submit(input.agentId, input.requestId, input.value, paseo),
  );
  server.handle(cancelRpc, (input, { paseo }) =>
    requests.cancel(input.agentId, input.requestId, paseo),
  );
  server.handle(statusRpc, (input) =>
    requests.status(input.agentId, input.requestId),
  );
  const cleanups = [
    server.before("agent.create", async ({ request }, { paseo }) => {
      if (
        request.config.internal ||
        request.config.mcpServers?.[MCP_SERVER_NAME]
      )
        return request;
      const gatewayForAgent = service(paseo);
      const token = await gatewayForAgent.createToken();
      const url = await gatewayForAgent.url();
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
      const token = request.env[SESSION_ENV_KEY];
      if (token) await service(paseo).bind(token, request.agentId);
      return request;
    }),
    server.on("agent.archived", ({ agent }) => requests.abortAgent(agent.id)),
  ];
  return async () => {
    for (const cleanup of cleanups) cleanup();
    requests.close();
    if (gateway) await gateway.shutdown();
  };
}
