import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  GLOB_LIMIT,
  GREP_MATCH_LIMIT,
  TOOL_READ_LIMIT,
  globVault,
  grepVault,
  listVault,
  readVault,
  vaultExists,
} from "./vault";

interface ToolContext {
  vault: { name: string | null };
  lastSyncedAt: string | null;
  stale: boolean;
}

export class Gateway {
  private readonly server = createServer((request, response) => {
    this.handle(request, response).catch((error: unknown) => {
      console.error(
        "obsidian request failed",
        error instanceof Error ? error.message : "Unknown error",
      );
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  private readonly tokens = new Set<string>();
  private readonly connections = new Set<McpServer>();
  private started: Promise<number> | undefined;

  constructor(
    private readonly root: string,
    private readonly describe: () => ToolContext,
  ) {}

  start(): Promise<number> {
    this.started ??= this.listen();
    return this.started;
  }

  async connection(): Promise<{ url: string; token: string }> {
    const port = await this.start();
    const token = randomUUID();
    this.tokens.add(token);
    return { url: `http://127.0.0.1:${String(port)}/mcp`, token };
  }

  async shutdown(): Promise<void> {
    if (this.started) await this.started;
    this.tokens.clear();
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

  private async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        reject(error);
      };
      this.server.once("error", fail);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.removeListener("error", fail);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Obsidian MCP listener unavailable");
    return address.port;
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const address = this.server.address();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : null;
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
    if (!token || !this.tokens.has(token)) {
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
    const server = new McpServer({ name: "obsidian", version: "0.1.0" });
    this.connections.add(server);
    const result = (payload: Record<string, unknown>) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ ...this.describe(), ...payload }),
        },
      ],
    });
    server.registerTool(
      "list_vault",
      {
        description:
          'List a folder of the Obsidian vault. Paths are vault-relative; the root is "". Returns at most 1000 entries.',
        inputSchema: z
          .object({
            path: z.string().default(""),
            depth: z.number().int().min(0).max(8).default(1),
          })
          .strict(),
      },
      async ({ path, depth }) => result(await this.list(path, depth)),
    );
    server.registerTool(
      "glob_vault",
      {
        description:
          'Find vault files by glob pattern, for example "**/*.md" or "Projects/2026/*". Returns at most 200 vault-relative paths.',
        inputSchema: z
          .object({
            pattern: z.string().min(1),
            limit: z.number().int().min(1).max(GLOB_LIMIT).optional(),
          })
          .strict(),
      },
      async ({ pattern, limit }) => result(await this.glob(pattern, limit)),
    );
    server.registerTool(
      "grep_vault",
      {
        description:
          "Search note text in the vault. Returns at most 100 matches with their file, line number and line text. Binary attachments are skipped.",
        inputSchema: z
          .object({
            query: z.string().min(1),
            regex: z.boolean().optional(),
            caseSensitive: z.boolean().optional(),
            include: z.string().optional(),
            limit: z.number().int().min(1).max(GREP_MATCH_LIMIT).optional(),
          })
          .strict(),
      },
      async ({ query, regex, caseSensitive, include, limit }) =>
        result(
          await this.grep(query, { regex, caseSensitive, include, limit }),
        ),
    );
    server.registerTool(
      "read_vault",
      {
        description:
          "Read a vault file as text. Paths are vault-relative. At most 256 KB per call; offset and limit select a byte window. Attachments return metadata only.",
        inputSchema: z
          .object({
            path: z.string().min(1),
            offset: z.number().int().min(0).optional(),
            limit: z.number().int().min(1).max(TOOL_READ_LIMIT).optional(),
          })
          .strict(),
      },
      async ({ path, offset, limit }) =>
        result(await this.read(path, offset, limit)),
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

  private async list(
    path: string,
    depth: number,
  ): Promise<Record<string, unknown>> {
    if (!(await vaultExists(this.root))) return { error: "vault_unavailable" };
    const listed = await listVault(this.root, path, depth);
    if (listed.status !== "ok") return { error: listed.status };
    return { entries: listed.entries, truncated: listed.truncated };
  }

  private async glob(
    pattern: string,
    limit?: number,
  ): Promise<Record<string, unknown>> {
    if (!(await vaultExists(this.root))) return { error: "vault_unavailable" };
    return globVault(this.root, pattern, limit ?? GLOB_LIMIT);
  }

  private async grep(
    query: string,
    options: {
      regex?: boolean;
      caseSensitive?: boolean;
      include?: string;
      limit?: number;
    },
  ): Promise<Record<string, unknown>> {
    if (!(await vaultExists(this.root))) return { error: "vault_unavailable" };
    return grepVault(this.root, query, options);
  }

  private async read(
    path: string,
    offset?: number,
    limit?: number,
  ): Promise<Record<string, unknown>> {
    if (!(await vaultExists(this.root))) return { error: "vault_unavailable" };
    const read = await readVault(
      this.root,
      path,
      limit ?? TOOL_READ_LIMIT,
      offset ?? 0,
    );
    if (read.status === "error")
      return {
        error: read.code,
        bytes: read.bytes,
        modifiedAt: read.modifiedAt,
      };
    return {
      path: read.path,
      text: read.text,
      truncated: read.truncated,
      bytes: read.bytes,
      modifiedAt: read.modifiedAt,
    };
  }
}
