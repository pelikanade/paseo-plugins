import type { ChildProcessByStdio, SpawnOptions } from "node:child_process";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import type { Readable, Writable } from "node:stream";
import { createTrustCheck, trustPath } from "./project";
import type { TrustCheck } from "./project";

type McpStdioServerConfig = Extract<
  NonNullable<
    PluginBeforeRequests["agent.create"]["config"]["mcpServers"]
  >[string],
  { type: "stdio" }
>;

export type McpChild = ChildProcessByStdio<Writable, Readable, Readable>;

export type McpPlatform = {
  realpath(path: string): Promise<string>;
  spawn(
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ): McpChild;
};

type Pending = {
  method: string;
  clientId: unknown;
  receive: (message: unknown) => void;
};

type Upstream = {
  child: McpChild;
  nextId: number;
  pending: Map<number, Pending>;
  buffer: string;
  stderr: string;
  idle?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  warm: boolean;
};

export async function serveMcp(
  root: string,
  binary: string,
  allowedFile: string,
  catalog: string,
  idleMs: number,
  checkTrust: TrustCheck,
  platform: McpPlatform,
): Promise<void> {
  const searchTools: Record<string, true> = {
    search_options: true,
    search_packages: true,
  };
  const warmBudgetMs = 30000;
  const warmRetryMs = 1000;
  const handshakeMs = 30000;
  const stopGraceMs = 1000;
  const handshakeVersion = "2025-06-18";
  const grouped = process.platform !== "win32";
  const canonical = await platform.realpath(root);
  if (!checkTrust(canonical, allowedFile)) {
    process.stderr.write(
      "devenv project is not trusted; allow it and reload the agent\n",
    );
    process.exitCode = 1;
    return;
  }
  let serverVersion = "devenv";
  let catalogTools: unknown = null;
  if (catalog) {
    try {
      const parsed: unknown = JSON.parse(catalog);
      if (typeof parsed === "object" && parsed !== null) {
        if ("version" in parsed && typeof parsed.version === "string")
          serverVersion = parsed.version;
        if ("tools" in parsed) catalogTools = parsed.tools;
      }
    } catch {
      catalogTools = null;
    }
  }
  let upstream: Upstream | null = null;
  let starting: Promise<Upstream | null> | null = null;
  let clientBuffer = "";
  let lastFailure = "devenv MCP server unavailable";

  const reason = (error: unknown) =>
    ` ${
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : ""
    }`.slice(-512);
  const write = (message: string) => {
    process.stdout.write(`${message}\n`);
  };
  const respond = (id: unknown, result: unknown) => {
    write(JSON.stringify({ jsonrpc: "2.0", id, result }));
  };
  const failure = (id: unknown, message: string) => {
    write(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message } }),
    );
  };
  const relay = (id: unknown, message: unknown) => {
    if (typeof message === "object" && message !== null) {
      if ("result" in message) {
        respond(id, message.result);
        return;
      }
      if ("error" in message) {
        write(JSON.stringify({ jsonrpc: "2.0", id, error: message.error }));
        return;
      }
    }
    failure(id, "devenv MCP server sent an unreadable response");
  };
  const isEmptyList = (message: unknown): boolean => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("result" in message)
    )
      return false;
    const result = message.result;
    if (
      typeof result !== "object" ||
      result === null ||
      !("content" in result) ||
      !Array.isArray(result.content) ||
      result.content.length === 0
    )
      return false;
    const first: unknown = result.content[0];
    if (typeof first !== "object" || first === null || !("text" in first))
      return false;
    const text = first.text;
    if (typeof text !== "string") return false;
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) && parsed.length === 0;
    } catch {
      return false;
    }
  };
  const stop = (target: Upstream) => {
    if (target.stopped) return;
    target.stopped = true;
    clearTimeout(target.idle);
    if (upstream === target) upstream = null;
    const pid = target.child.pid;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (grouped && pid !== undefined) process.kill(-pid, signal);
        else target.child.kill(signal);
      } catch (error) {
        process.stderr.write(`devenv mcp ${signal} failed:${reason(error)}\n`);
      }
    };
    kill("SIGTERM");
    setTimeout(() => {
      kill("SIGKILL");
    }, stopGraceMs);
    const stopped = target.stderr.trim().split("\n").slice(-2).join(" ");
    for (const entry of target.pending.values()) {
      if (entry.method === "tools/call") {
        write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: entry.clientId,
            result: {
              content: [
                { type: "text", text: `devenv MCP server stopped. ${stopped}` },
              ],
              isError: true,
            },
          }),
        );
      } else failure(entry.clientId, `devenv MCP server stopped. ${stopped}`);
    }
    target.pending.clear();
  };
  const touch = (target: Upstream) => {
    clearTimeout(target.idle);
    target.idle = undefined;
    if (idleMs <= 0 || target.stopped || target.pending.size > 0) return;
    target.idle = setTimeout(() => {
      stop(target);
    }, idleMs);
  };
  const exchange = (
    target: Upstream,
    method: string,
    params: unknown,
    clientId: unknown,
    receive: (message: unknown) => void,
  ) => {
    if (target.stopped) {
      receive({
        error: { code: -32603, message: `devenv MCP server stopped.` },
      });
      return;
    }
    const id = target.nextId;
    target.nextId += 1;
    target.pending.set(id, { method, clientId, receive });
    target.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  };
  const forward = (
    target: Upstream,
    method: string,
    params: unknown,
    clientId: unknown,
  ): Promise<unknown> =>
    new Promise<unknown>((resolve) => {
      exchange(target, method, params, clientId, resolve);
    });
  const readUpstream = (target: Upstream, chunk: string) => {
    target.buffer += chunk;
    const lines = target.buffer.split("\n");
    target.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || !("id" in parsed))
        continue;
      const id = parsed.id;
      if (typeof id !== "number") continue;
      const entry = target.pending.get(id);
      if (entry === undefined) continue;
      target.pending.delete(id);
      entry.receive(parsed);
    }
    if (target.pending.size === 0) touch(target);
  };
  const start = async (): Promise<Upstream> => {
    if (!checkTrust(canonical, allowedFile))
      throw new Error(
        "devenv project is not trusted; allow it and reload the agent",
      );
    const child = platform.spawn(binary, ["mcp"], {
      cwd: canonical,
      detached: grouped,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const target: Upstream = {
      child,
      nextId: 1,
      pending: new Map(),
      buffer: "",
      stderr: "",
      stopped: false,
      warm: false,
    };
    child.stdout.on("data", (chunk: Buffer) => {
      readUpstream(target, chunk.toString());
    });
    child.stdin.on("error", () => {
      stop(target);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      target.stderr = `${target.stderr}${chunk.toString()}`.slice(-2048);
    });
    child.on("error", (error) => {
      target.stderr = `${target.stderr}${reason(error)}`.slice(-2048);
      stop(target);
    });
    child.on("exit", () => {
      stop(target);
    });
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, handshakeMs);
      exchange(
        target,
        "initialize",
        {
          protocolVersion: handshakeVersion,
          capabilities: {},
          clientInfo: { name: "paseo-devenv", version: "1" },
        },
        undefined,
        (message) => {
          clearTimeout(timer);
          resolve(
            typeof message === "object" &&
              message !== null &&
              "result" in message,
          );
        },
      );
    });
    if (!ready) {
      const failed = target.stderr.trim().split("\n").slice(-2).join(" ");
      stop(target);
      throw new Error(`devenv mcp did not start. ${failed}`);
    }
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    return target;
  };
  const ensure = async (): Promise<Upstream> => {
    const running = upstream;
    if (running !== null && !running.stopped) return running;
    if (starting === null) {
      starting = start()
        .then((target) => {
          if (target.stopped) return null;
          upstream = target;
          touch(target);
          return target;
        })
        .catch((error: unknown) => {
          lastFailure = reason(error).trim();
          process.stderr.write(`${lastFailure}\n`);
          return null;
        })
        .finally(() => {
          starting = null;
        });
    }
    const target = await starting;
    if (target === null) throw new Error(lastFailure);
    return target;
  };
  const callTool = async (target: Upstream, params: unknown, id: unknown) => {
    const name =
      typeof params === "object" &&
      params !== null &&
      "name" in params &&
      typeof params.name === "string"
        ? params.name
        : null;
    const gated =
      name !== null && Object.hasOwn(searchTools, name) && !target.warm
        ? Date.now() + warmBudgetMs
        : 0;
    let message = await forward(target, "tools/call", params, id);
    while (
      gated > 0 &&
      !target.warm &&
      !target.stopped &&
      isEmptyList(message) &&
      Date.now() < gated
    ) {
      touch(target);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, warmRetryMs);
      });
      message = await forward(target, "tools/call", params, id);
    }
    if (gated > 0 && (!isEmptyList(message) || Date.now() >= gated))
      target.warm = true;
    relay(id, message);
  };
  const handle = async (line: string) => {
    if (!line.trim()) return;
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null || !("method" in parsed))
      return;
    const method = parsed.method;
    if (typeof method !== "string") return;
    const params = "params" in parsed ? parsed.params : undefined;
    const id = "id" in parsed ? parsed.id : undefined;
    if (id === undefined) return;
    if (method === "initialize") {
      respond(id, {
        protocolVersion:
          typeof params === "object" &&
          params !== null &&
          "protocolVersion" in params &&
          typeof params.protocolVersion === "string"
            ? params.protocolVersion
            : handshakeVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "devenv", version: serverVersion },
      });
      return;
    }
    if (method === "ping") {
      respond(id, {});
      return;
    }
    if (method === "tools/list") {
      const running = upstream;
      if (running !== null && !running.stopped && catalogTools === null) {
        touch(running);
        relay(id, await forward(running, method, params, id));
        return;
      }
      if (catalogTools !== null) {
        respond(id, { tools: catalogTools });
        return;
      }
      try {
        const target = await ensure();
        touch(target);
        relay(id, await forward(target, method, params, id));
      } catch (error) {
        failure(id, `devenv MCP server unavailable.${reason(error)}`);
      }
      return;
    }
    if (method === "tools/call") {
      try {
        const target = await ensure();
        touch(target);
        await callTool(target, params, id);
      } catch (error) {
        write(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `devenv MCP server unavailable.${reason(error)}`,
                },
              ],
              isError: true,
            },
          }),
        );
      }
      return;
    }
    write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      }),
    );
  };
  const shutdown = async () => {
    const target = upstream;
    if (target !== null) {
      stop(target);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, stopGraceMs + 100);
      });
    }
    process.exit(0);
  };
  process.stdout.on("error", () => undefined);
  process.stderr.on("error", () => undefined);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    clientBuffer += chunk;
    const lines = clientBuffer.split("\n");
    clientBuffer = lines.pop() ?? "";
    for (const line of lines) {
      handle(line).catch((error: unknown) => {
        process.stderr.write(`devenv mcp request failed:${reason(error)}\n`);
      });
    }
  });
  process.stdin.on("end", () => {
    shutdown().catch(() => undefined);
  });
  process.on("SIGTERM", () => {
    shutdown().catch(() => undefined);
  });
  process.on("SIGINT", () => {
    shutdown().catch(() => undefined);
  });
}

export function mcpConfig(
  root: string,
  binary: string,
  catalog: string,
  idleMs: number,
): McpStdioServerConfig {
  const script = `import * as fs from "node:fs"; import * as path from "node:path"; import { realpath } from "node:fs/promises"; import { spawn } from "node:child_process"; (${serveMcp.toString()})(...JSON.parse(process.argv[1]), (${createTrustCheck.toString()})(fs, path), { realpath, spawn }).catch(error => { console.error(error.message); process.exitCode = 1; });`;
  return {
    type: "stdio",
    command: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: "1" },
    args: [
      "--input-type=module",
      "-e",
      script,
      JSON.stringify([root, binary, trustPath(), catalog, idleMs]),
    ],
  };
}
