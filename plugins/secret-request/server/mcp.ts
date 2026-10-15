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

const envelopeSchema = z.looseObject({
  method: z.string(),
  id: z.union([z.string(), z.number()]).optional(),
  params: z
    .looseObject({
      requestId: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
});

function callKey(agentId: string, id: string | number): string {
  return `${agentId}\u0000${String(id)}`;
}

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
  private readonly calls = new Map<string, AbortController>();

  private paseo: Api | undefined;

  constructor(
    private readonly requests: Requests,
    private readonly storage: Storage,
  ) {}

  attach(paseo: Api): void {
    this.paseo = paseo;
  }

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
    signal: AbortSignal | undefined,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> {
    const paseo = this.paseo;
    if (paseo === undefined)
      return {
        content: [
          {
            type: "text",
            text: "The secret-request plugin is still starting up. Retry this call in a moment.",
          },
        ],
        isError: true,
      };
    const result = await this.requests.request(
      agentId,
      requestInputSchema.parse(input),
      paseo,
      signal,
    );
    if (result.status === "unavailable")
      return {
        content: [
          {
            type: "text",
            text:
              result.message ?? "Secret handover is unavailable on this host",
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
    const envelope = envelopeSchema.safeParse(body);
    if (
      envelope.success &&
      envelope.data.method === "notifications/cancelled"
    ) {
      const cancel = envelope.data.params?.requestId;
      if (cancel !== undefined)
        this.calls.get(callKey(agentId, cancel))?.abort();
      response.writeHead(202).end();
      return;
    }
    let caller: AbortController | undefined;
    let callerKey: string | undefined;
    if (
      envelope.success &&
      envelope.data.method === "tools/call" &&
      envelope.data.id !== undefined
    ) {
      const controller = new AbortController();
      caller = controller;
      callerKey = callKey(agentId, envelope.data.id);
      this.calls.set(callerKey, controller);
      response.once("close", () => {
        controller.abort();
      });
    }
    const server = new McpServer({ name: "secret-request", version: "0.1.0" });
    this.connections.add(server);
    server.registerTool(
      "request_secret",
      {
        description: [
          "Ask the user for one secret (API key, token, password) and block until they answer, cancel, or the request is gone.",
          "Returns a path to a RAM-backed file holding the value, never the value itself: use $(cat <path>) inside the command that needs it.",
          "Never print, log, echo or copy what you read, and never report its length, a prefix, a suffix or a hash of it either — size and fragments narrow a guess that should not be narrowed.",
          "One request per agent is live at a time, and a retry resumes it instead of stacking a second card, so a call that ends in a timeout or a cancellation is retried with the same label until it answers.",
          'A retry under the same label also collects a value the user already typed for a call that never came back; a trailing qualifier such as "(retry)" still matches. Once a caller has received a path, that label starts a new request instead.',
          "The card is a single-line masked field, so a multi-line secret (PEM, SSH key) either has to be base64-encoded by the user — put the exact command in `hint` — or arrives with its newlines stripped and you repair it.",
          "The file is deleted 15 minutes after delivery, and nothing can delete it earlier, so read it only where the value is needed.",
        ].join(" "),
        inputSchema: requestInputSchema,
      },
      async (input) => this.call(agentId, input, caller?.signal),
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
    try {
      await transport.handleRequest(request, response, body);
    } finally {
      if (callerKey !== undefined) this.calls.delete(callerKey);
    }
  }

  async shutdown() {
    for (const caller of this.calls.values()) caller.abort();
    this.calls.clear();
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
