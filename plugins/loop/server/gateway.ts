import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { armSchema } from "../shared/contracts";
import { skill } from "./skill.generated";
import { Loops } from "./loops";
import { State } from "./state";

type Api = PluginHandlerContext["paseo"];
const toolInput = armSchema.omit({ agentId: true });

export class Gateway {
  private readonly server = createServer((request, response) => {
    this.handle(request, response).catch((error: unknown) => {
      console.error(
        "loop request failed",
        error instanceof Error ? error.message : "Unknown error",
      );
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  private started: Promise<number> | undefined;
  private readonly connections = new Set<McpServer>();

  constructor(
    private readonly state: State,
    private readonly loops: Loops,
    private readonly paseo: Api,
  ) {}

  start() {
    this.started ??= (async () => {
      const port = await this.state.read((database) => database.port);
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
      await this.state.change((database) => {
        database.port = address.port;
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
      ? await this.state.authorize(authorization.slice(7))
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
        : Buffer.from(chunkText(chunk));
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
    await this.loops.requireAgent(agentId, this.paseo);
    const server = new McpServer({ name: "loop", version: "0.1.0" });
    this.connections.add(server);
    const json = (value: unknown) => ({
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
    });
    server.registerTool(
      "get_loop_guide",
      {
        description:
          "Read the bundled loop skill before arming or changing a loop.",
        inputSchema: z.object({}).strict(),
      },
      () => ({ content: [{ type: "text", text: skill }] }),
    );
    server.registerTool(
      "loop_status",
      {
        description: "Show this agent's loop, or stopped when none is armed.",
        inputSchema: z.object({}).strict(),
      },
      async () => json(await this.loops.status(agentId, this.paseo)),
    );
    server.registerTool(
      "loop_arm",
      {
        description:
          "Arm or replace this agent's local loop. Does not run the prompt. Fixed mode wakes after everySeconds. Dynamic mode needs heartbeatSeconds and may take a watch argv that prints one stdout line when an event happens.",
        inputSchema: toolInput,
      },
      async (input) =>
        json(await this.loops.arm({ ...input, agentId }, this.paseo)),
    );
    server.registerTool(
      "loop_stop",
      {
        description:
          "Stop this agent's loop, kill its watcher, and do not schedule another wake.",
        inputSchema: z.object({}).strict(),
      },
      async () => {
        await this.loops.requireAgent(agentId, this.paseo);
        return json(this.loops.stop(agentId));
      },
    );
    server.registerResource(
      "loop-skill",
      "skill://loop/SKILL.md",
      {
        mimeType: "text/markdown",
        description: "Bundled loop skill",
      },
      () => ({
        contents: [
          {
            uri: "skill://loop/SKILL.md",
            mimeType: "text/markdown",
            text: skill,
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

function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return "";
}
