import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { catalogDescription } from "../shared/catalog";
import { cardIdSchema, patchSchema, specSchema } from "../shared/protocol";
import { guide } from "../shared/guide.generated";
import { Cards } from "./cards";

type Api = PluginHandlerContext["paseo"];
export class Gateway {
  private readonly server = createServer((request, response) => {
    this.handle(request, response).catch((error: unknown) => {
      console.error(
        "generative-ui request failed",
        error instanceof Error ? error.message : "Unknown error",
      );
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  private started: Promise<number> | undefined;
  private readonly connections = new Set<McpServer>();

  constructor(
    private readonly cards: Cards,
    private readonly paseo: Api,
  ) {}

  start() {
    this.started ??= (async () => {
      const port = await this.cards.storage.read((db) => db.port);
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
        throw new Error("MCP listener unavailable");
      await this.cards.storage.change((db) => {
        db.port = address.port;
      });
      return address.port;
    })();
    return this.started;
  }

  async connection(token: string) {
    return { url: `http://127.0.0.1:${String(await this.start())}/mcp`, token };
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
      ? await this.cards.authorize(authorization.slice(7))
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
      if (bytes > 131072) {
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
    await this.cards.agent(agentId, this.paseo);
    const server = new McpServer({ name: "generative-ui", version: "0.1.0" });
    this.connections.add(server);
    const result = (value: unknown) => ({
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
    });
    server.registerTool(
      "get_ui_guide",
      {
        description:
          "Read the bundled generative-ui skill before creating interactive UI.",
        inputSchema: z.object({}).strict(),
      },
      () => ({ content: [{ type: "text", text: guide }] }),
    );
    server.registerTool(
      "get_ui_catalog",
      {
        description: "Get supported component props and actions.",
        inputSchema: z.object({}).strict(),
      },
      () => result(catalogDescription),
    );
    server.registerTool(
      "publish_ui",
      {
        description:
          "Publish a validated native card in this agent's Chat. Return immediately; user input is delivered as a later user message.",
        inputSchema: z
          .object({ cardId: cardIdSchema, spec: specSchema })
          .strict(),
      },
      async ({ cardId, spec }) =>
        result(
          await this.cards.publish(agentId, cardId, spec, "mcp", this.paseo),
        ),
    );
    server.registerTool(
      "patch_ui",
      {
        description:
          "Atomically apply ordered patches to a card at the expected revision. Set complete false while building, true to enable interaction.",
        inputSchema: z
          .object({
            cardId: cardIdSchema,
            revision: z.number().int().positive(),
            patches: z.array(patchSchema).min(1).max(100),
            complete: z.boolean(),
          })
          .strict(),
      },
      async ({ cardId, revision, patches, complete }) =>
        result(
          await this.cards.patch(
            agentId,
            cardId,
            revision,
            patches,
            complete,
            this.paseo,
          ),
        ),
    );
    server.registerTool(
      "get_ui_state",
      {
        description: "Read a card and its form state.",
        inputSchema: z.object({ cardId: cardIdSchema }).strict(),
      },
      async ({ cardId }) => result(await this.cards.values(agentId, cardId)),
    );
    server.registerTool(
      "close_ui",
      {
        description: "Close a card at its expected revision.",
        inputSchema: z
          .object({
            cardId: cardIdSchema,
            revision: z.number().int().positive(),
          })
          .strict(),
      },
      async ({ cardId, revision }) =>
        result(await this.cards.close(agentId, cardId, revision, this.paseo)),
    );
    server.registerResource(
      "generative-ui-skill",
      "skill://generative-ui/SKILL.md",
      {
        mimeType: "text/markdown",
        description: "Bundled agent skill and protocol references",
      },
      () => ({
        contents: [
          {
            uri: "skill://generative-ui/SKILL.md",
            mimeType: "text/markdown",
            text: guide,
          },
        ],
      }),
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
    if (this.server.listening) {
      this.server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        this.server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
  }
}
