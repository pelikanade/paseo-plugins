import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { requestInputSchema } from "../shared/protocol";
import type { Requests } from "./requests";
import type { Storage } from "./storage";

type Api = PluginHandlerContext["paseo"];

const BODY_LIMIT = 131072;

export class Gateway {
  private readonly server = createServer((request, response) => {
    this.handle(request, response).catch((error: unknown) => {
      console.error(
        "secret-request: MCP request failed",
        error instanceof Error ? error.message : "Unknown error",
      );
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  private started: Promise<number> | undefined;
  private readonly connections = new Set<McpServer>();

  constructor(
    private readonly requests: Requests,
    private readonly storage: Storage,
    private readonly paseo: Api,
  ) {}

  start(): Promise<number> {
    this.started ??= (async () => {
      const port = await this.storage.read((database) => database.port);
      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => {
          reject(error);
        };
        this.server.once("error", fail);
        this.server.listen(port, "127.0.0.1", () => {
          this.server.removeListener("error", fail);
          resolve();
        });
      });
      const address = this.server.address();
      if (!address || typeof address === "string")
        throw new Error("secret-request: MCP listener unavailable");
      await this.storage.change((database) => {
        database.port = address.port;
      });
      return address.port;
    })();
    return this.started;
  }

  async url(): Promise<string> {
    return `http://127.0.0.1:${String(await this.start())}/mcp`;
  }

  async connection(agentId: string): Promise<{ url: string; token: string }> {
    const token = await this.storage.read(
      (database) =>
        database.sessions.find((session) => session.agentId === agentId)
          ?.token ?? null,
    );
    if (token === null)
      throw new Error("No secret-request session is bound to this agent");
    return { url: await this.url(), token };
  }

  async createToken(): Promise<string> {
    const token = randomUUID();
    return this.storage.change((database) => {
      database.sessions.push({ token, agentId: null });
      return token;
    });
  }

  async bind(token: string, agentId: string): Promise<void> {
    await this.storage.change((database) => {
      const session = database.sessions.find((item) => item.token === token);
      if (session) session.agentId = agentId;
      else database.sessions.push({ token, agentId });
    });
  }

  private authorize(token: string): Promise<string | null> {
    return this.storage.read(
      (database) =>
        database.sessions.find((item) => item.token === token)?.agentId ?? null,
    );
  }

  private async call(
    agentId: string,
    input: unknown,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> {
    const result = await this.requests.request(
      agentId,
      requestInputSchema.parse(input),
      this.paseo,
    );
    if (result.status === "unavailable")
      return {
        content: [
          {
            type: "text",
            text: `Secret handover is unavailable on this host, so no card was shown: ${result.message ?? "unknown reason"}`,
          },
        ],
        isError: true,
      };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const address = this.server.address();
    if (
      !address ||
      typeof address === "string" ||
      request.headers.host !== `127.0.0.1:${String(address.port)}` ||
      request.headers.origin ||
      request.url !== "/mcp"
    ) {
      response.writeHead(403).end();
      return;
    }
    const authorization = request.headers.authorization;
    const agentId = authorization?.startsWith("Bearer ")
      ? await this.authorize(authorization.slice(7))
      : null;
    if (!agentId) {
      response.writeHead(401).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(z.string().parse(chunk));
      bytes += buffer.length;
      if (bytes > BODY_LIMIT) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(buffer);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      response.writeHead(400).end();
      return;
    }
    const server = new McpServer({ name: "secret-request", version: "0.1.0" });
    this.connections.add(server);
    const result = (value: unknown) => ({
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
    });
    server.registerTool(
      "request_secret",
      {
        description: [
          "Ask the user for one secret and block until they answer.",
          "Returns a path to a RAM-backed file holding the value; read it with $(cat <path>) and never print, log or echo what you read.",
          "The card accepts a single line, so a multi-line secret (PEM, SSH key) has to be base64-encoded by the user — say so in `hint` with the exact command — or it arrives with its newlines stripped and you repair it.",
          "The file is deleted 15 minutes after delivery, or earlier with secret_release.",
        ].join(" "),
        inputSchema: requestInputSchema,
      },
      async (input) => this.call(agentId, input),
    );
    server.registerTool(
      "secret_status",
      {
        description:
          "Check a secret request without waiting. Reports pending, delivered, canceled or gone.",
        inputSchema: z
          .object({
            requestId: z.string().min(1).max(100).optional(),
            label: z.string().min(1).max(200).optional(),
          })
          .strict(),
      },
      ({ requestId, label }) => {
        const found = this.requests.find(agentId, requestId, label);
        if (found === null)
          return result({ status: "gone", handoffExpiresAt: null });
        return result(this.requests.status(agentId, found));
      },
    );
    server.registerTool(
      "secret_release",
      {
        description:
          "Delete the handoff file for a delivered secret as soon as you are done with it.",
        inputSchema: z
          .object({ requestId: z.string().min(1).max(100) })
          .strict(),
      },
      async ({ requestId }) =>
        result({ status: await this.requests.release(agentId, requestId) }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.once("close", () => {
      server.close().catch(console.error);
      this.connections.delete(server);
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  }

  async shutdown() {
    if (this.started) await this.started;
    await Promise.all(
      Array.from(this.connections, (connection) => connection.close()),
    );
    if (this.server.listening)
      await new Promise<void>((resolve) => {
        this.server.close(() => {
          resolve();
        });
      });
  }
}
